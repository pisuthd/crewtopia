import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

/**
 * Crewtopia backend — serverless API (Lambda + API Gateway), TypeScript.
 * Starts with GET /health; POST /hire (bnbagent buyer flow)
 * lands here next — the server wallet lives in this stack, never in the browser.
 */
export class CrewtopiaBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const common: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30), // headroom for future chain calls
    };

    const healthFn = new nodejs.NodejsFunction(this, 'HealthFn', {
      ...common,
      entry: 'lambda/health.ts',
    });

    const agentCardFn = new nodejs.NodejsFunction(this, 'AgentCardFn', {
      ...common,
      entry: 'lambda/agent-card.ts',
    });

    const a2aFn = new nodejs.NodejsFunction(this, 'A2aFn', {
      ...common,
      entry: 'lambda/a2a/index.ts',
      memorySize: 512,
    });
    a2aFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['lambda:CreateMicrovmAuthToken', 'lambda:TerminateMicrovm', 'lambda:SuspendMicrovm', 'lambda:ResumeMicrovm', 'lambda:GetMicrovm'],
        resources: ['*'],
      }),
    );

    // Phase 2: task ledger — one row per buyer task, status machine lives here.
    const tasksTable = new dynamodb.Table(this, 'TasksTable', {
      partitionKey: { name: 'taskId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // testnet dry run; revisit for mainnet
    });
    tasksTable.grantReadWriteData(a2aFn);
    a2aFn.addEnvironment('TASKS_TABLE', tasksTable.tableName);

    // Phase 6: wallet sign-in + profiles. Nonces are single-use with a
    // Dynamo TTL; profiles are keyed by lowercase wallet address.
    const noncesTable = new dynamodb.Table(this, 'NoncesTable', {
      partitionKey: { name: 'address', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // testnet dry run; revisit for mainnet
    });
    const profilesTable = new dynamodb.Table(this, 'ProfilesTable', {
      partitionKey: { name: 'walletAddress', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // testnet dry run; revisit for mainnet
    });
    const sessionSecret = process.env.SESSION_SECRET ?? '';
    if (!sessionSecret) {
      throw new Error('SESSION_SECRET must be set (backend-cdk/.env, gitignored).');
    }
    const authFn = new nodejs.NodejsFunction(this, 'AuthFn', {
      ...common,
      entry: 'lambda/auth/index.ts',
    });
    noncesTable.grantReadWriteData(authFn);
    profilesTable.grantReadWriteData(authFn);
    authFn.addEnvironment('NONCES_TABLE', noncesTable.tableName);
    authFn.addEnvironment('PROFILES_TABLE', profilesTable.tableName);
    authFn.addEnvironment('SESSION_SECRET', sessionSecret);
    // Negotiator brain (optional): OpenAI-compatible endpoint + key. When
    // unset, negotiate falls back to the template PM (current behavior) —
    // tests stay green either way. Same testnet-only treatment as escrow keys.
    if (process.env.NEGOTIATOR_BASE_URL) {
      a2aFn.addEnvironment('NEGOTIATOR_BASE_URL', process.env.NEGOTIATOR_BASE_URL);
    }
    if (process.env.NEGOTIATOR_API_KEY) {
      a2aFn.addEnvironment('NEGOTIATOR_API_KEY', process.env.NEGOTIATOR_API_KEY);
    }
    if (process.env.NEGOTIATOR_MODEL) {
      a2aFn.addEnvironment('NEGOTIATOR_MODEL', process.env.NEGOTIATOR_MODEL);
    }
    // Testnet-only custodial provider wallet: holds the team's escrow
    // provider role (create/register/setBudget). NEVER mainnet keys here —
    // mainnet moves to Secrets Manager + KMS in Phase 5.
    const escrowKey = process.env.ESCROW_PRIVATE_KEY;
    const escrowPw = process.env.ESCROW_WALLET_PASSWORD;
    if (!escrowKey || !escrowPw) {
      throw new Error(
        'ESCROW_PRIVATE_KEY and ESCROW_WALLET_PASSWORD must be set (backend-cdk/.env, gitignored, testnet key only).',
      );
    }
    a2aFn.addEnvironment('ESCROW_PRIVATE_KEY', escrowKey);
    a2aFn.addEnvironment('ESCROW_WALLET_PASSWORD', escrowPw);
    a2aFn.addEnvironment('HOME', '/tmp'); // SDK keystore writes, if any, stay ephemeral

    const api = new apigateway.LambdaRestApi(this, 'CrewtopiaApi', {
      handler: healthFn,
      proxy: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    api.root.addResource('health').addMethod('GET', new apigateway.LambdaIntegration(healthFn));

    // Wallet sign-in (SIWE-lite): nonce → EIP-191 sign → session JWT.
    const auth = api.root.addResource('auth');
    auth
      .addResource('nonce')
      .addMethod('POST', new apigateway.LambdaIntegration(authFn));
    auth
      .addResource('verify')
      .addMethod('POST', new apigateway.LambdaIntegration(authFn));

    // Profiles (JWT-gated, sub = wallet address).
    const profile = api.root.addResource('profile');
    profile.addMethod('GET', new apigateway.LambdaIntegration(authFn));
    profile.addMethod('PUT', new apigateway.LambdaIntegration(authFn));

    // Phase 7: Ember — assistant catalog + assignment (REST) and streaming
    // chat (WebSocket). Transcript lives in DynamoDB; inference runs in
    // Lambda via PROVIDER_* (OpenAI-compatible), never the browser.
    const conversationsTable = new dynamodb.Table(this, 'ConversationsTable', {
      partitionKey: { name: 'conversationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // testnet dry run; revisit for mainnet
    });
    const connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // testnet dry run; revisit for mainnet
    });
    const providerBaseUrl = process.env.PROVIDER_BASE_URL ?? '';
    const providerModel = process.env.PROVIDER_MODEL ?? '';
    const providerKey = process.env.PROVIDER_API_KEY ?? '';
    if (!providerBaseUrl || !providerModel || !providerKey) {
      throw new Error('PROVIDER_BASE_URL, PROVIDER_MODEL and PROVIDER_API_KEY must be set (backend-cdk/.env, gitignored).');
    }
    const emberFn = new nodejs.NodejsFunction(this, 'EmberFn', {
      ...common,
      entry: 'lambda/ember/index.ts',
      timeout: cdk.Duration.seconds(120), // LLM streaming headroom (gateway caps routes at 29s)
      memorySize: 512,
    });
    conversationsTable.grantReadWriteData(emberFn);
    connectionsTable.grantReadWriteData(emberFn);
    profilesTable.grantReadWriteData(emberFn);
    tasksTable.grantReadWriteData(emberFn);
    // Member relay mints VM auth tokens; panel terminate destroys the VM.
    emberFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['lambda:CreateMicrovmAuthToken', 'lambda:SuspendMicrovm', 'lambda:ResumeMicrovm', 'lambda:GetMicrovm', 'lambda:TerminateMicrovm'],
        resources: ['*'],
      }),
    );
    emberFn.addEnvironment('CONVERSATIONS_TABLE', conversationsTable.tableName);
    emberFn.addEnvironment('CONNECTIONS_TABLE', connectionsTable.tableName);
    emberFn.addEnvironment('PROFILES_TABLE', profilesTable.tableName);
    emberFn.addEnvironment('TASKS_TABLE', tasksTable.tableName);
    emberFn.addEnvironment('SESSION_SECRET', sessionSecret);
    emberFn.addEnvironment('PROVIDER_BASE_URL', providerBaseUrl);
    emberFn.addEnvironment('PROVIDER_MODEL', providerModel);
    emberFn.addEnvironment('PROVIDER_API_KEY', providerKey);
    if (process.env.PROVIDER_CONTEXT_LIMIT) {
      emberFn.addEnvironment('PROVIDER_CONTEXT_LIMIT', process.env.PROVIDER_CONTEXT_LIMIT);
    }

    const assistants = api.root.addResource('assistants');
    assistants.addMethod('GET', new apigateway.LambdaIntegration(emberFn));
    assistants
      .addResource('assign')
      .addMethod('POST', new apigateway.LambdaIntegration(emberFn));
    api.root
      .addResource('chat')
      .addResource('history')
      .addMethod('GET', new apigateway.LambdaIntegration(emberFn));
    api.root
      .getResource('chat')
      ?.getResource('history')
      ?.addMethod('DELETE', new apigateway.LambdaIntegration(emberFn));
    api.root
      .addResource('rent')
      .addResource('pending')
      .addMethod('GET', new apigateway.LambdaIntegration(emberFn));
    const rent = api.root.getResource('rent');
    rent?.addResource('messages').addMethod('GET', new apigateway.LambdaIntegration(emberFn));
    rent?.addResource('team').addMethod('GET', new apigateway.LambdaIntegration(emberFn));
    rent?.addResource('sandbox').addResource('suspend').addMethod('POST', new apigateway.LambdaIntegration(emberFn));
    rent?.getResource('sandbox')?.addResource('terminate').addMethod('POST', new apigateway.LambdaIntegration(emberFn));

    // Streaming chat transport: one WebSocket API, one Lambda for all routes.
    const emberWs = new apigwv2.WebSocketApi(this, 'EmberWsApi', {
      apiName: 'CrewtopiaEmberWs',
      routeSelectionExpression: '$request.body.action',
      connectRouteOptions: { integration: new apigwv2Integrations.WebSocketLambdaIntegration('Connect', emberFn) },
      disconnectRouteOptions: { integration: new apigwv2Integrations.WebSocketLambdaIntegration('Disconnect', emberFn) },
      defaultRouteOptions: { integration: new apigwv2Integrations.WebSocketLambdaIntegration('Message', emberFn) },
    });
    new apigwv2.WebSocketStage(this, 'EmberWsStage', {
      webSocketApi: emberWs,
      stageName: 'prod',
      autoDeploy: true,
    });
    emberWs.grantManageConnections(emberFn);
    new cdk.CfnOutput(this, 'EmberWsUrl', {
      value: emberWs.apiEndpoint,
      description: 'Ember streaming chat WebSocket URL (append /prod)',
    });

    // A2A discovery (Phase 1 dry run; Phase 2 makes it dynamic).
    // agent.json alias: de-facto path some agents serve instead of the spec
    // agent-card.json — same card, both paths, maximum discoverability.
    const wellKnown = api.root.addResource('.well-known');
    wellKnown
      .addResource('agent-card.json')
      .addMethod('GET', new apigateway.LambdaIntegration(agentCardFn));
    wellKnown
      .addResource('agent.json')
      .addMethod('GET', new apigateway.LambdaIntegration(agentCardFn));

    const a2a = api.root.addResource('a2a');
    a2a
      .addResource('message')
      .addResource('send')
      .addMethod('POST', new apigateway.LambdaIntegration(a2aFn));
    // Public task receipt — the resolvable deliverable behind submit.
    a2a
      .addResource('tasks')
      .addResource('{taskId}')
      .addMethod('GET', new apigateway.LambdaIntegration(a2aFn));
    // Phase 4: provision-on-demand sandbox boot for funded tasks.
    const sandboxFn = new nodejs.NodejsFunction(this, 'SandboxFn', {
      ...common,
      entry: 'lambda/sandbox.ts',
      timeout: cdk.Duration.minutes(14),
      memorySize: 512,
    });
    tasksTable.grantReadWriteData(sandboxFn);
    sandboxFn.addEnvironment('TASKS_TABLE', tasksTable.tableName);
    conversationsTable.grantReadWriteData(sandboxFn);
    sandboxFn.addEnvironment('CONVERSATIONS_TABLE', conversationsTable.tableName);
    sandboxFn.addEnvironment(
      'COMPUTER_IMAGE_ARN',
      'arn:aws:lambda:ap-southeast-1:057386374967:microvm-image:wayfind-computer',
    );
    const modalKey = process.env.MODAL_API_KEY ?? process.env.NEGOTIATOR_API_KEY ?? '';
    if (modalKey) {
      sandboxFn.addEnvironment('MODAL_API_KEY', modalKey);
      sandboxFn.addEnvironment('PROVIDER_API_KEY', process.env.PROVIDER_API_KEY ?? modalKey);
    }
    sandboxFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          'lambda:RunMicrovm',
          'lambda:GetMicrovm',
          'lambda:CreateMicrovmAuthToken',
          'lambda:TerminateMicrovm',
          'lambda:SuspendMicrovm',
          'lambda:ResumeMicrovm',
          'lambda:PassNetworkConnector',
        ],
        resources: ['*'],
      }),
    );
    // Auto-boot: the a2a status flip invokes the sandbox builder async.
    // The builder trusts direct Invoke (IAM-gated); the HTTPS path below
    // still requires the provider signature.
    a2aFn.addEnvironment('SANDBOX_FN', sandboxFn.functionName);
    sandboxFn.grantInvoke(a2aFn);
    const sandboxRes = a2a.addResource('sandbox');
    sandboxRes
      .addResource('boot')
      .addMethod('POST', new apigateway.LambdaIntegration(sandboxFn));

    // Phase 4: preview relay — signed dev-port proxy, token held server-side.
    const previewFn = new nodejs.NodejsFunction(this, 'PreviewFn', {
      ...common,
      entry: 'lambda/preview.ts',
      memorySize: 512,
    });
    tasksTable.grantReadWriteData(previewFn);
    previewFn.addEnvironment('TASKS_TABLE', tasksTable.tableName);
    const previewSecret = process.env.PREVIEW_SECRET ?? '';
    if (!previewSecret) {
      throw new Error('PREVIEW_SECRET must be set (backend-cdk/.env, gitignored).');
    }
    previewFn.addEnvironment('PREVIEW_SECRET', previewSecret);
    previewFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['lambda:CreateMicrovmAuthToken'],
        resources: ['*'],
      }),
    );
    // preview-link skill (a2aFn) mints the same HMAC URLs server-side.
    a2aFn.addEnvironment('PREVIEW_SECRET', previewSecret);
    // In-thread receipts: status flips (a2aFn) and sandbox-live (sandboxFn)
    // announce into the Ember thread.
    conversationsTable.grantReadWriteData(a2aFn);
    a2aFn.addEnvironment('CONVERSATIONS_TABLE', conversationsTable.tableName);
    const preview = sandboxRes.addResource('preview');
    preview?.addResource('link').addMethod('POST', new apigateway.LambdaIntegration(previewFn));
    preview
      ?.addResource('view')
      .addResource('{taskId}')
      .addResource('{port}')
      .addResource('{proxy+}')
      .addMethod('GET', new apigateway.LambdaIntegration(previewFn));

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Crewtopia backend base URL',
    });
  }
}

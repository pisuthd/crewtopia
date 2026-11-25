import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';

/**
 * Crewtopia backend — serverless API (Lambda + API Gateway), TypeScript.
 * The server wallet lives in this stack, never in the browser.
 */
export class CrewtopiaBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const common: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30), // headroom for future chain calls
    };

    const fallbackFn = new nodejs.NodejsFunction(this, 'FallbackFn', {
      ...common,
      entry: 'lambda/fallback.ts',
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
    // Negotiator brain (optional): meta endpoint + key via PROVIDER_*.
    // When unset, negotiate falls back to the template PM (current behavior) —
    // tests stay green either way. Same testnet-only treatment as escrow keys.
    if (process.env.PROVIDER_BASE_URL) {
      a2aFn.addEnvironment('PROVIDER_BASE_URL', process.env.PROVIDER_BASE_URL);
    }
    if (process.env.PROVIDER_API_KEY) {
      a2aFn.addEnvironment('PROVIDER_API_KEY', process.env.PROVIDER_API_KEY);
    }
    if (process.env.PROVIDER_MODEL) {
      a2aFn.addEnvironment('PROVIDER_MODEL', process.env.PROVIDER_MODEL);
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
      handler: fallbackFn,
      proxy: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      // Signed preview proxy returns images/fonts/zips — API Gateway must
      // treat these as binary (Lambda returns isBase64Encoded bodies).
      // Existing JSON routes are unaffected (flag is per-response).
      binaryMediaTypes: [
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'image/x-icon',
        'image/avif',
        'font/woff',
        'font/woff2',
        'font/ttf',
        'application/font-woff',
        'application/octet-stream',
        'application/zip',
        'application/pdf',
        'application/wasm',
        'audio/*',
        'video/*',
      ],
    });

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

    // Phase 7: app backend — teams, hire/quote, crew chat, sandbox, preview
    // (REST). Transcripts live in the VM; inference runs in Lambda via
    // PROVIDER_* (OpenAI-compatible), never the browser.
    // Per-wallet sandboxes (option B): free personal workspaces, no rental.
    // PK = lowercase wallet address. computerId is wallet-stable so backups
    // survive VM replacement.
    const sandboxTable = new dynamodb.Table(this, 'SandboxTable', {
      partitionKey: { name: 'wallet', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // testnet dry run; revisit for mainnet
    });
    // Custom team registry (stored teams). PK = namespaced teamId
    // (`custom-<addr6>-<slug>`); owner field scopes rows to wallets.
    const teamRegistryTable = new dynamodb.Table(this, 'TeamRegistryTable', {
      partitionKey: { name: 'teamId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // testnet dry run; revisit for mainnet
    });
    const providerBaseUrl = process.env.PROVIDER_BASE_URL ?? '';
    const providerModel = process.env.PROVIDER_MODEL ?? '';
    const providerKey = process.env.PROVIDER_API_KEY ?? '';
    if (!providerBaseUrl || !providerModel || !providerKey) {
      throw new Error('PROVIDER_BASE_URL, PROVIDER_MODEL and PROVIDER_API_KEY must be set (backend-cdk/.env, gitignored).');
    }
    const appFn = new nodejs.NodejsFunction(this, 'AppFn', {
      ...common,
      entry: 'lambda/app/index.ts',
      timeout: cdk.Duration.seconds(360),
      memorySize: 512,
    });
    profilesTable.grantReadWriteData(appFn);
    tasksTable.grantReadWriteData(appFn);
    sandboxTable.grantReadWriteData(appFn);
    teamRegistryTable.grantReadWriteData(appFn);
    teamRegistryTable.grantReadData(a2aFn);
    a2aFn.addEnvironment('TEAM_REGISTRY_TABLE', teamRegistryTable.tableName);
    sandboxTable.grantReadData(a2aFn);
    a2aFn.addEnvironment('SANDBOX_TABLE', sandboxTable.tableName);
    // Guest Talk URL base for the crew-voice-link skill. Empty = skill
    // returns the /voice/g/<id> path and the buyer prefixes the app origin.
    a2aFn.addEnvironment('FRONTEND_URL', process.env.FRONTEND_URL ?? '');
    appFn.addEnvironment('FRONTEND_URL', process.env.FRONTEND_URL ?? '');
    // Member relay mints VM auth tokens; panel terminate destroys the VM.
    appFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['lambda:CreateMicrovmAuthToken', 'lambda:SuspendMicrovm', 'lambda:ResumeMicrovm', 'lambda:GetMicrovm', 'lambda:TerminateMicrovm'],
        resources: ['*'],
      }),
    );
    appFn.addEnvironment('PROFILES_TABLE', profilesTable.tableName);
    appFn.addEnvironment('TASKS_TABLE', tasksTable.tableName);
    appFn.addEnvironment('SANDBOX_TABLE', sandboxTable.tableName);
    appFn.addEnvironment('TEAM_REGISTRY_TABLE', teamRegistryTable.tableName);
    appFn.addEnvironment('SESSION_SECRET', sessionSecret);
    appFn.addEnvironment('PROVIDER_BASE_URL', providerBaseUrl);
    appFn.addEnvironment('PROVIDER_MODEL', providerModel);
    appFn.addEnvironment('PROVIDER_API_KEY', providerKey);
    if (process.env.PROVIDER_CONTEXT_LIMIT) {
      appFn.addEnvironment('PROVIDER_CONTEXT_LIMIT', process.env.PROVIDER_CONTEXT_LIMIT);
    }
    // ElevenLabs Speech Engine (voice crew): engine CRUD + WebRTC tokens.
    // Missing key = voice token route 503s; everything else keeps working.
    if (process.env.ELEVENLABS_API_KEY) {
      appFn.addEnvironment('ELEVENLABS_API_KEY', process.env.ELEVENLABS_API_KEY);
    }

    // Rental + team + sandbox routes (session-authed inside the handler).
    api.root
      .addResource('rent')
      .addResource('pending')
      .addMethod('GET', new apigateway.LambdaIntegration(appFn));
    const rent = api.root.getResource('rent');
    rent?.addResource('messages').addMethod('GET', new apigateway.LambdaIntegration(appFn));
    rent?.addResource('team').addMethod('GET', new apigateway.LambdaIntegration(appFn));
    rent?.addResource('teams').addMethod('GET', new apigateway.LambdaIntegration(appFn));
    rent?.getResource('teams')?.addMethod('POST', new apigateway.LambdaIntegration(appFn));
    rent?.getResource('teams')?.addMethod('PUT', new apigateway.LambdaIntegration(appFn));
    rent?.getResource('teams')?.addMethod('DELETE', new apigateway.LambdaIntegration(appFn));
    rent?.addResource('crew').addResource('chat').addMethod('POST', new apigateway.LambdaIntegration(appFn));
    rent?.getResource('crew')?.getResource('chat')?.addMethod('GET', new apigateway.LambdaIntegration(appFn));
    // Single greedy slot for newer app routes: each explicit gateway method
    // costs a Lambda::Permission (~150B) and the AppFn policy is at the 20KB
    // cap — so /rent/io/{proxy+} carries voice/upload/providers/context and
    // add-member with in-Lambda routing instead of five more methods.
    const io = rent?.addResource('io').addResource('{proxy+}');
    io?.addMethod('ANY', new apigateway.LambdaIntegration(appFn));
    rent?.addResource('sandbox').addResource('suspend').addMethod('POST', new apigateway.LambdaIntegration(appFn));
    rent?.getResource('sandbox')?.addResource('terminate').addMethod('POST', new apigateway.LambdaIntegration(appFn));
    rent?.getResource('sandbox')?.addResource('boot').addMethod('POST', new apigateway.LambdaIntegration(appFn));
    rent?.getResource('sandbox')?.addResource('resume').addMethod('POST', new apigateway.LambdaIntegration(appFn));
    rent?.getResource('sandbox')?.addResource('token').addMethod('POST', new apigateway.LambdaIntegration(appFn));
    rent?.getResource('sandbox')?.addResource('status').addMethod('GET', new apigateway.LambdaIntegration(appFn));
    // Signed sandbox preview (browser-navigable, token-gated): minter is
    // session-authed; the greedy proxy carries the HMAC in query/cookie.
    rent?.addResource('preview').addResource('token').addMethod('POST', new apigateway.LambdaIntegration(appFn));
    rent?.getResource('preview')?.addResource('{proxy+}').addMethod('GET', new apigateway.LambdaIntegration(appFn));

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
    // Per-team cards (option B): same lambda, routed by {teamId}.
    // Root card above stays dev-crew for back-compat.
    const teamCards = wellKnown.addResource('teams').addResource('{teamId}');
    teamCards
      .addResource('agent-card.json')
      .addMethod('GET', new apigateway.LambdaIntegration(agentCardFn));
    teamCards
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
    sandboxTable.grantReadWriteData(sandboxFn);
    sandboxFn.addEnvironment('SANDBOX_TABLE', sandboxTable.tableName);
    // Idle-park DISABLED (platform auto-suspend terminates instead of parking).
    // Keep maxed out so the platform never triggers it; parking is explicit
    // flush + terminate + boot. Max microVM lifetime is 8h regardless.
    sandboxFn.addEnvironment('SANDBOX_IDLE_SECONDS', process.env.SANDBOX_IDLE_SECONDS ?? '28800');
    sandboxFn.addEnvironment(
      'COMPUTER_IMAGE_ARN',
      'arn:aws:lambda:ap-southeast-1:057386374967:microvm-image:crewtopia-computer',
    );
    // VM inference key: single Meta key (PROVIDER_API_KEY). Legacy MODAL_API_KEY
    // passes through only when set (old images); new images are meta-only.
    const vmProviderKey = process.env.PROVIDER_API_KEY ?? '';
    if (process.env.MODAL_API_KEY) {
      sandboxFn.addEnvironment('MODAL_API_KEY', process.env.MODAL_API_KEY);
    }
    if (vmProviderKey) {
      sandboxFn.addEnvironment('PROVIDER_API_KEY', vmProviderKey);
    }
    // VM voice server (Speech Engine attach) reads this at attach time.
    if (process.env.ELEVENLABS_API_KEY) {
      sandboxFn.addEnvironment('ELEVENLABS_API_KEY', process.env.ELEVENLABS_API_KEY);
    }
    // Real API base for the VM deliver tool (RestApi URL is stable; override
    // via COMPUTER_API_URL env when deploying anywhere else).
    sandboxFn.addEnvironment(
      'COMPUTER_API_URL',
      process.env.COMPUTER_API_URL ?? 'https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod',
    );
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
    // App drives per-wallet sandbox boot/resume the same way (async Invoke).
    appFn.addEnvironment('SANDBOX_FN', sandboxFn.functionName);
    sandboxFn.grantInvoke(appFn);
    const sandboxRes = a2a.addResource('sandbox');
    sandboxRes
      .addResource('boot')
      .addMethod('POST', new apigateway.LambdaIntegration(sandboxFn));
    // Delivery handoff: VM uploads source zips here (presigned PUT), buyers
    // download via presigned GET minted at submit. Private bucket, no public
    // policy — testnet DESTROY for clean teardown.
    const deliveries = new s3.Bucket(this, 'DeliveriesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
    });
    sandboxRes
      .addResource('delivery')
      .addResource('put-url')
      .addMethod('POST', new apigateway.LambdaIntegration(sandboxFn));
    sandboxRes
      .getResource('delivery')
      ?.addResource('get-url')
      .addMethod('POST', new apigateway.LambdaIntegration(sandboxFn));
    // Workspace backup (VM ↔ S3, presigned per-file URLs, usage-token gated).
    sandboxRes
      .addResource('sync')
      .addResource('upload-urls')
      .addMethod('POST', new apigateway.LambdaIntegration(sandboxFn));
    sandboxRes
      .getResource('sync')
      ?.addResource('download-urls')
      .addMethod('POST', new apigateway.LambdaIntegration(sandboxFn));
    sandboxFn.addEnvironment('DELIVERIES_BUCKET', deliveries.bucketName);
    deliveries.grantPut(sandboxFn);
    deliveries.grantRead(sandboxFn);
    a2aFn.addEnvironment('DELIVERIES_BUCKET', deliveries.bucketName);
    deliveries.grantRead(a2aFn);

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Crewtopia backend base URL',
    });
  }
}

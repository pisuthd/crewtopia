#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { loadEnv } from '@bnbagent/sdk';
import { CrewtopiaBackendStack } from '../lib/backend-stack';

// Deploy-time config (not AWS target env below): backend-cdk/.env supplies
// ESCROW_PRIVATE_KEY / ESCROW_WALLET_PASSWORD, which the stack bakes into the
// A2A lambda's environment (testnet key only — mainnet uses Secrets Manager).
// This replaces fragile shell-passing: `cdk deploy` alone is sufficient.
loadEnv(__dirname + '/..');

const app = new cdk.App();
new CrewtopiaBackendStack(app, 'CrewtopiaBackendStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// Dump recent runtime streams of the computer image log group.
// Run: npx tsx scripts/a2a/4-vm-logs.ts [minutes]   (default 30)
import { CloudWatchLogsClient, DescribeLogStreamsCommand, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

const REGION = process.env.AWS_REGION ?? 'ap-southeast-1';
const GROUP = '/aws/lambda-microvms/crewtopia-computer';
const mins = Number(process.argv[2] ?? 30);
const cutoff = Date.now() - mins * 60_000;
const logs = new CloudWatchLogsClient({ region: REGION });

async function main(): Promise<void> {
  const streams = await logs.send(new DescribeLogStreamsCommand({
    logGroupName: GROUP, orderBy: 'LastEventTime', descending: true, limit: 50,
  }));
  for (const s of streams.logStreams ?? []) {
    if (cutoff > 0 && (s.lastEventTimestamp ?? 0) < cutoff) { console.log(`(older: ${s.logStreamName} last=${new Date(s.lastEventTimestamp ?? 0).toISOString()})`); continue; }
    console.log(`=== stream: ${s.logStreamName} last=${new Date(s.lastEventTimestamp ?? 0).toISOString()}`);
    let token: string | undefined;
    for (let i = 0; i < 5; i++) {
      const ev = await logs.send(new GetLogEventsCommand({
        logGroupName: GROUP, logStreamName: s.logStreamName, nextToken: token, limit: 100,
      }));
      for (const e of ev.events ?? []) {
        console.log(new Date(e.timestamp ?? 0).toISOString(), (e.message ?? '').slice(0, 300));
      }
      if (!ev.nextForwardToken || ev.nextForwardToken === token) break;
      token = ev.nextForwardToken;
    }
  }
}

void main();

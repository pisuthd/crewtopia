import { LambdaMicrovmsClient, ListMicrovmsCommand, TerminateMicrovmCommand, GetMicrovmCommand } from "@aws-sdk/client-lambda-microvms";

const vm = new LambdaMicrovmsClient({ region: "ap-southeast-1" });
const list = await vm.send(new ListMicrovmsCommand({}));
const items = list.microvms ?? list.items ?? [];
console.log("count:", items.length);
for (const it of items) {
  const id = it.microvmIdentifier ?? it.microvmId ?? it.microvmArn;
  let state = it.state;
  try {
    const got = await vm.send(new GetMicrovmCommand({ microvmIdentifier: id }));
    state = got.state;
  } catch { /* ignore */ }
  console.log(id, JSON.stringify(state), it.createdAt ?? it.startedAt ?? "");
}
const target = process.argv[2];
if (target) {
  await vm.send(new TerminateMicrovmCommand({ microvmIdentifier: target }));
  console.log("terminated", target);
}

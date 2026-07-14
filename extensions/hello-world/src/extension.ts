import { initialize, type ActivationContext } from "@ableton-extensions/sdk";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  console.log("Hello from ableton-agent-toolkit's hello-world extension.");
  console.log(`Live song has ${context.application.song.tracks.length} track(s).`);

  context.commands.registerCommand("helloWorld.ping", () => {
    console.log("helloWorld.ping invoked.");
  });
}

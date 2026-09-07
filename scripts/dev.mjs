import { spawn } from "node:child_process";

const children = [];

function run(name, args) {
  const child = spawn("npm", args, {
    stdio: "inherit",
    env: process.env
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      for (const c of children) c.kill();
      process.exit(code);
    }
  });
  children.push(child);
}

run("host", ["run", "dev", "-w", "@dbk/host"]);
run("web", ["run", "dev", "-w", "@dbk/web"]);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const c of children) c.kill();
    process.exit(0);
  });
}

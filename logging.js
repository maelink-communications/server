import chalk from "chalk";

const startTime = Date.now();
export function log(message, color = "white") {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(3);
    const colorFn = chalk[color] || chalk.white;
    console.log(colorFn(`[${elapsed}] ${message}`));
}
import chalk from "chalk";

const startTime = Date.now();
export function log(message, color = "white", hex = 0, bg = 0) { // bg ONLY to be used for hexes!
    let colorFn;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(3);
    if (hex && bg) {
        colorFn = chalk.bgHex(color).black;
    } else if (hex) {
        colorFn = chalk.hex(color);
    } else {
        colorFn = chalk[color] || chalk.white;
    }
    console.log(colorFn(`[${elapsed}] ${message}`));
}
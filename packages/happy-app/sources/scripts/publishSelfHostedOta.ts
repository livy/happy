#!/usr/bin/env tsx

import { spawnSync } from "child_process";
import { createRequire } from "module";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type Options = {
    channel: string;
    runtimeVersion: string;
    platform: "android" | "ios" | "all";
    outputRoot: string;
};

function readArg(name: string) {
    const index = process.argv.indexOf(name);
    if (index === -1) {
        return undefined;
    }
    return process.argv[index + 1];
}

function readExpoConfig() {
    const configPath = path.resolve(__dirname, "../../app.config.js");
    const requireFromConfig = createRequire(configPath);
    delete requireFromConfig.cache?.[configPath];
    const mod = requireFromConfig(configPath);
    const value = typeof mod === "function" ? mod({ config: {} }) : mod.default || mod;

    return value.expo || value;
}

function parseOptions(): Options {
    const expoConfig = readExpoConfig();
    const channel = readArg("--channel") || process.env.APP_ENV || "preview";
    const runtimeVersion = readArg("--runtime-version") || String(expoConfig.runtimeVersion);
    const platform = (readArg("--platform") || "android") as Options["platform"];
    const outputRoot = path.resolve(
        readArg("--output-root") ||
        process.env.HAPPY_OTA_OUTPUT_DIR ||
        path.resolve(__dirname, "../../../happy-server/updates"),
    );

    if (!runtimeVersion) {
        throw new Error("Missing runtime version");
    }
    if (!["android", "ios", "all"].includes(platform)) {
        throw new Error(`Unsupported platform: ${platform}`);
    }

    return { channel, runtimeVersion, platform, outputRoot };
}

function run(command: string, args: string[], cwd: string, env = process.env) {
    console.log(`> ${command} ${args.join(" ")}`);
    const result = spawnSync(command, args, {
        cwd,
        env,
        stdio: "inherit",
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function copyDirectory(source: string, destination: string) {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
}

function main() {
    const options = parseOptions();
    const appRoot = path.resolve(__dirname, "../..");
    const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "happy-ota-"));
    const publishedAt = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(
        options.outputRoot,
        options.runtimeVersion,
        options.channel,
        publishedAt,
    );

    run("pnpm", ["typecheck"], appRoot);
    run("pnpm", [
        "exec",
        "expo",
        "export",
        "--platform",
        options.platform,
        "--output-dir",
        exportDir,
        "--dump-assetmap",
        "--source-maps",
        "false",
    ], appRoot, {
        ...process.env,
        APP_ENV: options.channel,
        NODE_ENV: options.channel === "production" ? "production" : process.env.NODE_ENV || options.channel,
    });

    const expoConfig = readExpoConfig();
    fs.writeFileSync(
        path.join(exportDir, "expoConfig.json"),
        JSON.stringify(expoConfig, null, 2),
    );

    copyDirectory(exportDir, destination);
    fs.rmSync(exportDir, { recursive: true, force: true });

    console.log(`Published self-hosted OTA update: ${destination}`);
}

main();

import crypto, { BinaryLike, BinaryToTextEncoding } from "crypto";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { type Fastify } from "../types";

type Platform = "android" | "ios";

type ExportMetadata = {
    fileMetadata: Record<Platform, {
        bundle: string;
        assets: Array<{
            path: string;
            ext: string;
        }>;
    }>;
};

class NoUpdateAvailableError extends Error {}

function createHash(file: BinaryLike, algorithm: string, encoding: BinaryToTextEncoding) {
    return crypto.createHash(algorithm).update(file).digest(encoding);
}

function base64Url(value: string) {
    return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hashToUuid(value: string) {
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function getMimeType(extension: string | null | undefined) {
    switch ((extension || "").replace(/^\./, "").toLowerCase()) {
        case "hbc":
        case "js":
            return "application/javascript";
        case "json":
            return "application/json";
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "webp":
            return "image/webp";
        case "gif":
            return "image/gif";
        case "svg":
            return "image/svg+xml";
        case "ttf":
            return "font/ttf";
        case "otf":
            return "font/otf";
        case "woff":
            return "font/woff";
        case "woff2":
            return "font/woff2";
        default:
            return "application/octet-stream";
    }
}

function getUpdatesRoot() {
    return path.resolve(process.env.HAPPY_OTA_UPDATES_DIR || "/data/happy-ota-updates");
}

function getPublicBaseUrl(request: any) {
    const configured = process.env.HAPPY_OTA_PUBLIC_URL;
    if (configured) {
        return configured.replace(/\/$/, "");
    }
    const host = request.headers["x-forwarded-host"] || request.headers.host;
    const proto = request.headers["x-forwarded-proto"] || request.protocol || "http";
    return `${proto}://${host}`;
}

async function getLatestUpdatePath(runtimeVersion: string, channel: string) {
    const channelPath = path.join(getUpdatesRoot(), runtimeVersion, channel);
    const entries = await fsp.readdir(channelPath, { withFileTypes: true });
    const updates = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a));

    if (updates.length === 0) {
        throw new Error(`No updates found for runtime ${runtimeVersion} on channel ${channel}`);
    }

    return path.join(channelPath, updates[0]);
}

function resolveUpdateFile(updatePath: string, filePath: string) {
    const fullPath = path.resolve(updatePath, filePath);
    const basePath = path.resolve(updatePath);
    if (fullPath !== basePath && !fullPath.startsWith(basePath + path.sep)) {
        throw new Error("Invalid update asset path");
    }
    return fullPath;
}

async function readJson<T>(filePath: string): Promise<T> {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

async function getUpdateMetadata(updatePath: string) {
    const metadataPath = path.join(updatePath, "metadata.json");
    const metadataBuffer = await fsp.readFile(metadataPath);
    const metadataJson = JSON.parse(metadataBuffer.toString("utf8")) as ExportMetadata;
    const metadataStat = await fsp.stat(metadataPath);

    return {
        metadataJson,
        createdAt: metadataStat.mtime.toISOString(),
        id: createHash(metadataBuffer, "sha256", "hex"),
    };
}

async function getAssetMetadata(
    request: any,
    updatePath: string,
    runtimeVersion: string,
    channel: string,
    platform: Platform,
    filePath: string,
    ext: string | null,
    isLaunchAsset: boolean,
) {
    const assetPath = resolveUpdateFile(updatePath, filePath);
    const asset = await fsp.readFile(assetPath);
    const keyExtensionSuffix = isLaunchAsset ? "bundle" : ext || "bin";
    const contentType = isLaunchAsset ? "application/javascript" : getMimeType(ext);
    const url = new URL("/api/assets", getPublicBaseUrl(request));

    url.searchParams.set("runtimeVersion", runtimeVersion);
    url.searchParams.set("channel", channel);
    url.searchParams.set("platform", platform);
    url.searchParams.set("file", filePath);

    return {
        hash: base64Url(createHash(asset, "sha256", "base64")),
        key: createHash(asset, "md5", "hex"),
        fileExtension: `.${keyExtensionSuffix}`,
        contentType,
        url: url.toString(),
    };
}

async function createManifestResponse(
    request: any,
    updatePath: string,
    runtimeVersion: string,
    channel: string,
    platform: Platform,
) {
    const { metadataJson, createdAt, id } = await getUpdateMetadata(updatePath);
    const updateId = hashToUuid(id);

    if (request.headers["expo-current-update-id"] === updateId) {
        throw new NoUpdateAvailableError();
    }

    const expoConfig = await readJson(path.join(updatePath, "expoConfig.json"));
    const platformMetadata = metadataJson.fileMetadata[platform];
    if (!platformMetadata) {
        throw new Error(`No ${platform} update metadata found`);
    }

    return {
        id: updateId,
        createdAt,
        runtimeVersion,
        assets: await Promise.all(platformMetadata.assets.map((asset) =>
            getAssetMetadata(request, updatePath, runtimeVersion, channel, platform, asset.path, asset.ext, false)
        )),
        launchAsset: await getAssetMetadata(
            request,
            updatePath,
            runtimeVersion,
            channel,
            platform,
            platformMetadata.bundle,
            null,
            true,
        ),
        metadata: {},
        extra: {
            expoClient: expoConfig,
        },
    };
}

function sendMultipart(reply: any, protocolVersion: number, partName: "manifest" | "directive", body: unknown) {
    const boundary = `expo-${crypto.randomBytes(16).toString("hex")}`;
    const parts = [
        [
            `--${boundary}`,
            `Content-Disposition: form-data; name="${partName}"`,
            "Content-Type: application/json; charset=utf-8",
            "",
            JSON.stringify(body),
        ].join("\r\n"),
    ];
    if (partName === "manifest") {
        parts.push([
            `--${boundary}`,
            'Content-Disposition: form-data; name="extensions"',
            "Content-Type: application/json",
            "",
            JSON.stringify({ assetRequestHeaders: {} }),
        ].join("\r\n"));
    }
    parts.push(`--${boundary}--`);

    reply
        .header("expo-protocol-version", protocolVersion)
        .header("expo-sfv-version", 0)
        .header("cache-control", "private, max-age=0")
        .header("content-type", `multipart/mixed; boundary=${boundary}`)
        .send(Buffer.from(parts.join("\r\n"), "utf8"));
}

export function updateRoutes(app: Fastify) {
    app.get("/api/manifest", async (request, reply) => {
        const protocolVersion = parseInt(String(request.headers["expo-protocol-version"] || "0"), 10);
        const platform = request.headers["expo-platform"] || (request.query as any).platform;
        const runtimeVersion = request.headers["expo-runtime-version"] || (request.query as any)["runtime-version"];
        const channel = request.headers["expo-channel-name"] || (request.query as any).channel || "preview";

        if (platform !== "android" && platform !== "ios") {
            reply.code(400).send({ error: 'Unsupported platform. Expected "android" or "ios".' });
            return;
        }
        if (!runtimeVersion || typeof runtimeVersion !== "string") {
            reply.code(400).send({ error: "No runtimeVersion provided." });
            return;
        }
        if (typeof channel !== "string") {
            reply.code(400).send({ error: "Invalid update channel." });
            return;
        }

        try {
            const updatePath = await getLatestUpdatePath(runtimeVersion, channel);
            const manifest = await createManifestResponse(request, updatePath, runtimeVersion, channel, platform);
            sendMultipart(reply, protocolVersion, "manifest", manifest);
        } catch (error) {
            if (error instanceof NoUpdateAvailableError && protocolVersion === 1) {
                sendMultipart(reply, 1, "directive", { type: "noUpdateAvailable" });
                return;
            }
            reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
        }
    });

    app.get("/api/assets", {
        schema: {
            querystring: z.object({
                runtimeVersion: z.string(),
                channel: z.string().default("preview"),
                platform: z.enum(["android", "ios"]),
                file: z.string(),
            }),
        },
    }, async (request, reply) => {
        const { runtimeVersion, channel, platform, file } = request.query;

        try {
            const updatePath = await getLatestUpdatePath(runtimeVersion, channel);
            const assetPath = resolveUpdateFile(updatePath, file);
            if (!fs.existsSync(assetPath)) {
                reply.code(404).send({ error: "Asset not found." });
                return;
            }

            const { metadataJson } = await getUpdateMetadata(updatePath);
            const platformMetadata = metadataJson.fileMetadata[platform];
            const assetMetadata = platformMetadata.assets.find((asset) => asset.path === file);
            const isLaunchAsset = platformMetadata.bundle === file;
            const contentType = isLaunchAsset
                ? "application/javascript"
                : getMimeType(assetMetadata?.ext);

            reply
                .header("content-type", contentType)
                .send(await fsp.readFile(assetPath));
        } catch (error) {
            reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
        }
    });
}

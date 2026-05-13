const fs = require("fs");
const path = require("path");
const { withDangerousMod, withGradleProperties } = require("@expo/config-plugins");

const GRADLE_PROPERTIES = {
  reactNativeArchitectures: "arm64-v8a",
  "android.enableMinifyInReleaseBuilds": "true",
  "android.enableShrinkResourcesInReleaseBuilds": "true",
};

const PROGUARD_MARKER = "# Android release size optimization rules";
const PROGUARD_RULES = `${PROGUARD_MARKER}
# Optional dependency references used by Expo/Netty modules.
-dontwarn expo.modules.core.MapHelper
-dontwarn io.netty.internal.tcnative.**
-dontwarn org.apache.log4j.**
-dontwarn org.apache.logging.log4j.**
-dontwarn org.slf4j.**
-dontwarn sun.security.util.**
-dontwarn sun.security.x509.**
`;

function setGradleProperty(properties, key, value) {
  const existing = properties.find(
    (property) => property.type === "property" && property.key === key,
  );

  if (existing) {
    existing.value = value;
    return;
  }

  properties.push({
    type: "property",
    key,
    value,
  });
}

function withReleaseGradleProperties(config) {
  return withGradleProperties(config, (gradleConfig) => {
    for (const [key, value] of Object.entries(GRADLE_PROPERTIES)) {
      setGradleProperty(gradleConfig.modResults, key, value);
    }

    return gradleConfig;
  });
}

function withReleaseProguardRules(config) {
  return withDangerousMod(config, [
    "android",
    (modConfig) => {
      const proguardPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "proguard-rules.pro",
      );

      if (!fs.existsSync(proguardPath)) {
        fs.mkdirSync(path.dirname(proguardPath), { recursive: true });
        fs.writeFileSync(proguardPath, `${PROGUARD_RULES}\n`);
        return modConfig;
      }

      const currentRules = fs.readFileSync(proguardPath, "utf8");
      if (!currentRules.includes(PROGUARD_MARKER)) {
        const separator = currentRules.endsWith("\n") ? "" : "\n";
        fs.writeFileSync(proguardPath, `${currentRules}${separator}\n${PROGUARD_RULES}`);
      }

      return modConfig;
    },
  ]);
}

function withAndroidReleaseOptimization(config) {
  config = withReleaseGradleProperties(config);
  config = withReleaseProguardRules(config);

  return config;
}

module.exports = withAndroidReleaseOptimization;

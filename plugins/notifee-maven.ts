import type { ConfigPlugin } from "@expo/config-plugins";
import { withProjectBuildGradle } from "@expo/config-plugins";

/**
 * Registers Notifee's locally-bundled core AAR
 * (@notifee/react-native/android/libs) as a Maven repository in the
 * generated android/build.gradle, walking up the tree because this
 * workspace installs node_modules outside the project directory.
 */

const REPO_RESOLVER = [
  "",
  "def notifeeCoreMavenDir = null",
  '["../node_modules", "../../node_modules", "../../../node_modules"].each { rel ->',
  '  def candidate = file("$rootDir/$rel/@notifee/react-native/android/libs")',
  "  if (candidate.exists()) notifeeCoreMavenDir = candidate.absolutePath",
  "}",
  'if (notifeeCoreMavenDir == null) notifeeCoreMavenDir = "$rootDir/../node_modules/@notifee/react-native/android/libs"',
  "",
].join("\n");

const MAVEN_ENTRY = "    maven { url notifeeCoreMavenDir }";

function addNotifeeCoreRepo(gradleContents: string): string {
  if (gradleContents.includes("notifeeCoreMavenDir")) return gradleContents;

  let next = gradleContents.replace("allprojects {", `${REPO_RESOLVER}\nallprojects {`);
  next = next.replace(
    "    maven { url 'https://www.jitpack.io' }",
    `    maven { url 'https://www.jitpack.io' }\n${MAVEN_ENTRY}`
  );
  return next;
}

const withNotifeeMaven: ConfigPlugin = (config) =>
  withProjectBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = addNotifeeCoreRepo(
      modConfig.modResults.contents
    );
    return modConfig;
  });

export default withNotifeeMaven;

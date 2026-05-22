/** Environment variables safe to inherit. Everything else is stripped to prevent leaking secrets to LLM/tool output. */
const ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "CLICOLOR",
  "CLICOLOR_FORCE",
  "NO_COLOR",
  "FORCE_COLOR",
  // Development toolchains
  "NODE_PATH",
  "NVM_DIR",
  "NPM_CONFIG_PREFIX",
  "PNPM_HOME",
  "GOPATH",
  "GOROOT",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "PYENV_ROOT",
  "VIRTUAL_ENV",
  "CONDA_DEFAULT_ENV",
  "CONDA_PREFIX",
  "JAVA_HOME",
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "RUBY_VERSION",
  "GEM_HOME",
  "RBENV_ROOT",
]);

export function getSafeToolEnv(sourceEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = { TERM: "dumb", GG_CODER: "true" };
  for (const key of ENV_ALLOWLIST) {
    const value = sourceEnv[key];
    if (value) env[key] = value;
  }
  return env;
}

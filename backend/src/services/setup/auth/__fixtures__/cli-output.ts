/**
 * Sign-in output captured from the real CLIs on a headless Linux host.
 * Escape sequences are retained because the parsers must handle terminal
 * hyperlinks and cursor-positioned prompts, not cleaned-up test strings.
 */

/** `codex login --device-auth`, stdout, still polling when it was killed. */
export const CODEX_DEVICE_AUTH_STDOUT =
  "\nWelcome to Codex [v\u001b[90m0.145.0\u001b[0m]\n" +
  "\nFollow these steps to sign in with ChatGPT using device code authorization:\n" +
  "\n1. Open this link in your browser and sign in to your account\n" +
  "   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n" +
  "\n2. Enter this one-time code (expires in 15 minutes)\n" +
  "   \u001b[94mU927-TJEHB\u001b[0m\n";

const CLAUDE_AUTH_URL =
  "https://claude.com/cai/oauth/authorize?code=true" +
  "&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e" +
  "&response_type=code" +
  "&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback" +
  "&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference" +
  "+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload" +
  "&code_challenge=GAUsbYPwV3m1KBJ0iuOuNZ-D3wLAvGMUnQOIYGSPTQo" +
  "&code_challenge_method=S256" +
  "&state=tEX-QY86F4w_i8kDfxIhkVLJa7zSdw9yMI6F4Cv9DLs";

/** `claude auth login --claudeai`, from the link through the code prompt. */
export const CLAUDE_AUTH_LOGIN_PTY =
  "Opening browser to sign in…\n" +
  "If the browser didn't open, visit: " +
  `\u001b]8;;${CLAUDE_AUTH_URL}\u0007` +
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-" +
  "\u001b]8;;\u0007\n" +
  "\u001b[2GPaste\u001b[8Gcode\u001b[13Ghere\u001b[18Gif\u001b[21Gprompted\u001b[30G>";

/** A rejected code leaves the CLI alive and ready for another attempt. */
export const CLAUDE_OAUTH_ERROR_PTY =
  "\u001b[2K\u001b[1G\u001b[31mOAuth error: Invalid code. Please make sure the full code was copied\u001b[39m\n" +
  "\u001b[2GPress\u001b[8GEnter\u001b[14Gto\u001b[17Gretry.\n";

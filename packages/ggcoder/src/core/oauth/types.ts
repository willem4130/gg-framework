export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms timestamp
  accountId?: string; // OpenAI chatgpt_account_id from JWT
}

export interface OAuthLoginCallbacks {
  onOpenUrl: (url: string) => void;
  onPromptCode: (message: string) => Promise<string>;
  onStatus: (message: string) => void;
}

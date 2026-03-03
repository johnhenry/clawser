import { BrowserTool, BrowserToolRegistry } from './clawser-tools.js';

export declare class ChromeWriterTool extends BrowserTool {
  get name(): 'chrome_ai_write';
  get description(): string;
  get parameters(): object;
  get permission(): 'auto';
  execute(params: {
    prompt: string;
    tone?: 'formal' | 'neutral' | 'casual';
    format?: 'plain-text' | 'markdown';
    length?: 'short' | 'medium' | 'long';
    sharedContext?: string;
  }): Promise<{ success: boolean; output: string; error?: string }>;
}

export declare class ChromeRewriterTool extends BrowserTool {
  get name(): 'chrome_ai_rewrite';
  get description(): string;
  get parameters(): object;
  get permission(): 'auto';
  execute(params: {
    text: string;
    tone?: 'as-is' | 'more-formal' | 'more-casual';
    format?: 'as-is' | 'plain-text' | 'markdown';
    length?: 'as-is' | 'shorter' | 'longer';
    context?: string;
  }): Promise<{ success: boolean; output: string; error?: string }>;
}

export declare class ChromeSummarizerTool extends BrowserTool {
  get name(): 'chrome_ai_summarize';
  get description(): string;
  get parameters(): object;
  get permission(): 'auto';
  execute(params: {
    text: string;
    type?: 'key-points' | 'tl;dr' | 'teaser' | 'headline';
    format?: 'plain-text' | 'markdown';
    length?: 'short' | 'medium' | 'long';
    context?: string;
  }): Promise<{ success: boolean; output: string; error?: string }>;
}

export declare function registerChromeAITools(registry: BrowserToolRegistry): void;

import { Injectable } from '@nestjs/common';
import * as TurndownService from 'turndown';
import { parse } from 'marked';

@Injectable()
export class ContentConverterService {
  private readonly td: TurndownService;

  constructor() {
    this.td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  }

  htmlToMarkdown(html: string): string {
    let cleaned = html;
    let prev: string;
    do {
      prev = cleaned;
      cleaned = cleaned
        .replace(/<ac:[^>]*>[\s\S]*?<\/ac:[^>]*>/g, '')
        .replace(/<ri:[^/]*\/>/g, '');
    } while (cleaned !== prev);
    return this.td.turndown(cleaned);
  }

  markdownToHtml(markdown: string): string {
    return parse(markdown) as string;
  }
}

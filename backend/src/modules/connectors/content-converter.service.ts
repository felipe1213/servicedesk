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
    const cleaned = html
      .replace(/<ac:[^>]*>[\s\S]*?<\/ac:[^>]*>/g, '')
      .replace(/<ri:[^/]*\/>/g, '');
    return this.td.turndown(cleaned);
  }

  markdownToHtml(markdown: string): string {
    return parse(markdown) as string;
  }
}

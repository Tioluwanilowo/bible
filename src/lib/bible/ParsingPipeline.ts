import { NumberWordConverter } from './NumberWordConverter';
import { ScriptureReferenceParser } from './ScriptureReferenceParser';
import { ScriptureContextResolver } from './ScriptureContextResolver';
import { ReferenceValidator } from './ReferenceValidator';
import { ParsedReference, ParsingResult } from './types';
import { Scripture } from '../../types';

export class ParsingPipeline {
  public static parse(text: string, currentContext: Scripture | null = null): ParsingResult {
    const normalizedText = NumberWordConverter.convert(text);
    
    let reference = ScriptureContextResolver.resolveContextualCommand(normalizedText, currentContext);
    
    if (!reference) {
      reference = ScriptureReferenceParser.parse(normalizedText);
    }
    
    reference = ReferenceValidator.validate(reference);
    
    return {
      originalText: text,
      normalizedText,
      reference
    };
  }
}

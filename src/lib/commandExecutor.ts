import { Command, Scripture, Settings, ExecutionResult } from '../types';
import { getScripture, getNextVerse, getPrevVerse, getExtendedRange, getGotoVerse } from './bibleEngine';

export function executeCommand(
  command: Command,
  context: Scripture | null,
  version: string,
  settings: Settings
): ExecutionResult {
  let target: Scripture | null = null;
  let confidence = command.confidence;
  let notes = '';

  try {
    switch (command.intent) {
      case 'OPEN_REFERENCE':
        target = getScripture(command.payload.book, command.payload.chapter, command.payload.verse, version, command.payload.endVerse);
        if (!target) {
          confidence = 0.3;
          notes = `Reference not found in sample data: ${command.payload.book} ${command.payload.chapter}:${command.payload.verse}${command.payload.endVerse ? `-${command.payload.endVerse}` : ''}`;
        }
        break;
      case 'NEXT_VERSE':
        if (!context) throw new Error('Missing context');
        target = getNextVerse(context);
        if (!target) throw new Error('End of available data');
        break;
      case 'PREVIOUS_VERSE':
        if (!context) throw new Error('Missing context');
        target = getPrevVerse(context);
        if (!target) throw new Error('Beginning of chapter');
        break;
      case 'CONTINUE_READING':
        if (!context) throw new Error('Missing context');
        target = getExtendedRange(context);
        if (!target) throw new Error('End of available data');
        break;
      case 'GOTO_VERSE':
        if (!context) throw new Error('Missing context');
        target = getGotoVerse(context, command.payload.verse);
        if (!target) throw new Error('Verse not found in chapter');
        break;
      case 'START_FROM_VERSE':
        if (!context) throw new Error('Missing context');
        target = getScripture(context.book, context.chapter, command.payload.verse, version, context.endVerse);
        if (!target) throw new Error('Verse not found in chapter');
        break;
      case 'SWITCH_VERSION':
        if (!context) throw new Error('Missing context');
        target = getScripture(context.book, context.chapter, context.verse, command.payload.version, context.endVerse);
        if (!target) throw new Error(`Version ${command.payload.version} not available for this passage`);
        break;
    }
  } catch (err: any) {
    confidence = 0.3;
    notes = err.message;
  }

  const requiresApproval = confidence >= settings.mediumConfidenceThreshold && confidence < settings.highConfidenceThreshold;
  const canUpdateLive = confidence >= settings.highConfidenceThreshold;

  return {
    scripture: target,
    confidence,
    notes: notes || 'Resolved successfully',
    requiresApproval,
    canUpdateLive
  };
}

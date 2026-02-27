export interface ParsedSegment {
  type: 'text' | 'thought';
  content: string;
  isComplete?: boolean;
}

export function parseThoughts(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  const openTag = '<commentary>';
  const closeTag = '</commentary>';
  
  let currentIndex = 0;
  
  while (currentIndex < text.length) {
    const openIndex = text.indexOf(openTag, currentIndex);
    
    if (openIndex === -1) {
      // No more thought blocks, remaining is text
      const remaining = text.slice(currentIndex);
      if (remaining) {
        segments.push({ type: 'text', content: remaining });
      }
      break;
    }
    
    // Add text before the thought block
    if (openIndex > currentIndex) {
      segments.push({ type: 'text', content: text.slice(currentIndex, openIndex) });
    }
    
    // Find closing tag
    const contentStartIndex = openIndex + openTag.length;
    const closeIndex = text.indexOf(closeTag, contentStartIndex);
    
    if (closeIndex === -1) {
      // Open thought block (streaming/incomplete)
      const thoughtContent = text.slice(contentStartIndex);
      segments.push({ type: 'thought', content: thoughtContent, isComplete: false });
      // We consume the rest of the string as thought content
      currentIndex = text.length; 
    } else {
      // Closed thought block
      const thoughtContent = text.slice(contentStartIndex, closeIndex);
      segments.push({ type: 'thought', content: thoughtContent, isComplete: true });
      currentIndex = closeIndex + closeTag.length;
    }
  }
  
  return segments;
}

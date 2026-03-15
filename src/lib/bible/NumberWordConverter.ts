const numberWords: Record<string, number> = {
  'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14,
  'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18,
  'nineteen': 19, 'twenty': 20, 'thirty': 30, 'forty': 40,
  'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80,
  'ninety': 90, 'hundred': 100,
  'first': 1, 'second': 2, 'third': 3
};

export class NumberWordConverter {
  public static convert(text: string): string {
    let result = text.toLowerCase();
    
    const words = result.split(/\s+/);
    const converted: string[] = [];
    
    let currentNumber = 0;
    let isBuildingNumber = false;
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (numberWords[word] !== undefined) {
        const val = numberWords[word];
        
        if (!isBuildingNumber) {
          isBuildingNumber = true;
          currentNumber = val;
        } else {
          let canAdd = false;
          
          if (val === 100) {
            if (currentNumber < 100) {
              currentNumber = currentNumber === 0 ? 100 : currentNumber * 100;
              canAdd = true;
            }
          } else if (val >= 20) {
            if (currentNumber % 100 === 0) {
              currentNumber += val;
              canAdd = true;
            }
          } else {
            // val < 20
            if (currentNumber % 10 === 0 && currentNumber % 100 !== 10) {
              currentNumber += val;
              canAdd = true;
            }
          }
          
          if (!canAdd) {
            converted.push(currentNumber.toString());
            currentNumber = val;
          }
        }
      } else if (word === 'and' && isBuildingNumber && currentNumber >= 100) {
        // Skip 'and' in phrases like "one hundred and twenty"
        continue;
      } else {
        if (isBuildingNumber) {
          converted.push(currentNumber.toString());
          currentNumber = 0;
          isBuildingNumber = false;
        }
        converted.push(word);
      }
    }
    
    if (isBuildingNumber) {
      converted.push(currentNumber.toString());
    }
    
    return converted.join(' ');
  }
}

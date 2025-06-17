import * as fs from 'fs';
import * as path from 'path';

class DictionaryService {
  private words: Set<string> | null = null;
  private isLoaded: boolean = false;

  async loadDictionary(): Promise<void> {
    // Don't reload if already loaded
    if (this.isLoaded && this.words) {
      return;
    }

    console.log('Loading dictionary...');
    
    try {
      // Try multiple possible local paths
      const possiblePaths = [
        path.join(process.cwd(), 'public', 'sowpods.txt'),
        path.join(process.cwd(), 'src', 'services', 'gaddag', 'sowpods.txt'),
        path.join(__dirname, 'gaddag', 'sowpods.txt')
      ];
      
      for (const localPath of possiblePaths) {
        if (fs.existsSync(localPath)) {
          console.log(`Loading dictionary from: ${localPath}`);
          const content = fs.readFileSync(localPath, 'utf8');
          this.words = new Set(content.trim().split('\n').map(word => word.trim().toUpperCase()));
          this.isLoaded = true;
          console.log(`Dictionary loaded successfully with ${this.words.size} words`);
          return;
        }
      }
      
      throw new Error('No local dictionary file found. Checked paths: ' + possiblePaths.join(', '));
    } catch (error) {
      console.error('Failed to load dictionary from local files:', error);
      throw new Error('Could not load dictionary from local files');
    }
  }

  async isValidWord(word: string): Promise<boolean> {
    if (!word || word.length === 0) {
      return false;
    }

    // Only load dictionary if not already loaded
    if (!this.isLoaded || !this.words) {
      await this.loadDictionary();
    }
    
    if (!this.words) {
      throw new Error('Dictionary not loaded');
    }

    return this.words.has(word.toUpperCase());
  }

  getDictionarySize(): number {
    return this.words ? this.words.size : 0;
  }

  isDictionaryLoaded(): boolean {
    return this.isLoaded;
  }
}

// Export a singleton instance
export const dictionaryService = new DictionaryService();

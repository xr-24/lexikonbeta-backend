import type { Intercession, IntercessionsType } from '../types/game';

export const INTERCESSION_DEFINITIONS: Record<IntercessionsType, Omit<Intercession, 'id' | 'currentCooldown'>> = {
  MICHAEL: {
    type: 'MICHAEL',
    name: 'Judgement of Michael',
    description: 'Directly inflicts 30 damage to the enemy\'s HP.',
    cooldown: 4
  },
  SAMAEL: {
    type: 'SAMAEL',
    name: 'Wrath of Samael',
    description: 'Your next word played deals double damage to the enemy.',
    cooldown: 4
  },
  RAPHAEL: {
    type: 'RAPHAEL',
    name: 'Benediction of Raphael',
    description: 'Restores 50 HP to yourself.',
    cooldown: 8
  },
  URIEL: {
    type: 'URIEL',
    name: 'Protection of Uriel',
    description: 'Reduces damage received by 50% during opponent\'s next turn.',
    cooldown: 4
  },
  GABRIEL: {
    type: 'GABRIEL',
    name: 'Insight of Gabriel',
    description: 'Automatically plays your highest-scoring possible word, or deals 30 damage if no word is found.',
    cooldown: 6
  },
  METATRON: {
    type: 'METATRON',
    name: 'Intercession of Metatron',
    description: 'Restore 100 HP to yourself.',
    cooldown: 16
  }
};

export const INTERCESSION_TYPES: IntercessionsType[] = [
  'MICHAEL',
  'SAMAEL', 
  'RAPHAEL',
  'URIEL',
  'GABRIEL',
  'METATRON'
];

export function createIntercession(type: IntercessionsType): Intercession {
  const definition = INTERCESSION_DEFINITIONS[type];
  return {
    ...definition,
    id: `intercession-${type.toLowerCase()}-${Date.now()}-${Math.random()}`,
    currentCooldown: 0 // Start with no cooldown
  };
}

export function getIntercessionByType(type: IntercessionsType): Omit<Intercession, 'id' | 'currentCooldown'> {
  return INTERCESSION_DEFINITIONS[type];
}

export function createPlayerIntercessions(selectedTypes: IntercessionsType[]): Intercession[] {
  return selectedTypes.map(type => createIntercession(type));
}

// Bot personalities ("training profiles"). Weight shape mirrors cold-clear-2's
// freestyle BotConfig so swapping in the real wasm bot later keeps this data usable.

export interface FreestyleWeights {
  cellCoveredness: number
  maxCellCoveredHeight: number
  holes: number
  rowTransitions: number
  height: number
  heightUpperHalf: number
  heightUpperQuarter: number
  tetrisWellDepth: number
  tslot: [number, number, number, number]
  hasBackToBack: number
  wastedT: number
  softdrop: number
  normalClears: [number, number, number, number, number]
  miniSpinClears: [number, number, number]
  spinClears: [number, number, number, number]
  backToBackClear: number
  comboAttack: number
  perfectClear: number
  perfectClearOverride: boolean
}

export interface BotProfile {
  id: string
  label: string
  description: string
  weights: FreestyleWeights
}

const OPTIMAL: FreestyleWeights = {
  cellCoveredness: -0.2,
  maxCellCoveredHeight: 6,
  holes: -1.5,
  rowTransitions: -0.2,
  height: -0.4,
  heightUpperHalf: -1.5,
  heightUpperQuarter: -5.0,
  tetrisWellDepth: 0.3,
  tslot: [0.1, 1.5, 2.0, 4.0],
  hasBackToBack: 0.5,
  wastedT: -1.5,
  softdrop: -0.2,
  normalClears: [0.0, -2.0, -1.5, -1.0, 3.5],
  miniSpinClears: [0.0, -1.5, -1.0],
  spinClears: [0.0, 1.0, 4.0, 6.0],
  backToBackClear: 1.0,
  comboAttack: 1.5,
  perfectClear: 15.0,
  perfectClearOverride: true,
}

export const BOT_PROFILES: BotProfile[] = [
  {
    id: 'optimal',
    label: 'OPTIMAL',
    description: 'balanced all-round play (upstream defaults)',
    weights: { ...OPTIMAL },
  },
  {
    id: 'spin-finder',
    label: 'SPIN FINDER',
    description: 'hunts T/S/Z/J/L spins aggressively',
    weights: {
      ...OPTIMAL,
      holes: -1.0,
      height: -0.25,
      tslot: [1.0, 3.0, 5.0, 8.0],
      wastedT: -3.0,
      spinClears: [0.0, 4.0, 8.0, 12.0],
      miniSpinClears: [0.0, 1.0, 2.0],
      normalClears: [0.0, -3.0, -3.0, -2.5, 1.0],
    },
  },
  {
    id: 'perfect-clear',
    label: 'PERFECT CLEAR',
    description: 'chases perfect clears, tolerates messy boards',
    weights: {
      ...OPTIMAL,
      holes: -0.4,
      rowTransitions: -0.05,
      heightUpperHalf: -0.5,
      heightUpperQuarter: -2.0,
      normalClears: [0.0, -4.0, -3.0, -2.0, 0.0],
      perfectClear: 40.0,
    },
  },
  {
    id: 'clean-stack',
    label: 'CLEAN STACKER',
    description: 'flat, hole-free stacking above all else',
    weights: {
      ...OPTIMAL,
      cellCoveredness: -0.6,
      holes: -6.0,
      rowTransitions: -0.6,
      height: -0.8,
      heightUpperHalf: -3.0,
      heightUpperQuarter: -10.0,
      tslot: [0.0, 0.5, 1.0, 2.0],
      tetrisWellDepth: 1.0,
      normalClears: [0.0, -0.5, 0.5, 1.5, 4.0],
      spinClears: [0.0, 0.5, 1.0, 1.5],
    },
  },
  {
    id: 'b2b-maintainer',
    label: 'B2B KEEPER',
    description: 'keeps back-to-back chains alive at all costs',
    weights: {
      ...OPTIMAL,
      hasBackToBack: 3.0,
      backToBackClear: 5.0,
      normalClears: [0.0, -4.0, -3.0, -2.0, 5.0],
      spinClears: [0.0, 3.0, 6.0, 9.0],
      wastedT: -2.5,
    },
  },
]

export function getBotProfile(id: string): BotProfile {
  return BOT_PROFILES.find((p) => p.id === id) ?? BOT_PROFILES[0]
}

/** Serializes a profile into cold-clear-2's snake_case BotConfig JSON. */
export function cc2ConfigJson(profileId: string): string {
  const w = getBotProfile(profileId).weights
  return JSON.stringify({
    freestyle_weights: {
      cell_coveredness: w.cellCoveredness,
      max_cell_covered_height: w.maxCellCoveredHeight,
      holes: w.holes,
      row_transitions: w.rowTransitions,
      height: w.height,
      height_upper_half: w.heightUpperHalf,
      height_upper_quarter: w.heightUpperQuarter,
      tetris_well_depth: w.tetrisWellDepth,
      tslot: w.tslot,
      has_back_to_back: w.hasBackToBack,
      wasted_t: w.wastedT,
      softdrop: w.softdrop,
      normal_clears: w.normalClears,
      mini_spin_clears: w.miniSpinClears,
      spin_clears: w.spinClears,
      back_to_back_clear: w.backToBackClear,
      combo_attack: w.comboAttack,
      perfect_clear: w.perfectClear,
      perfect_clear_override: w.perfectClearOverride,
    },
    freestyle_exploitation: 0.6931471805599453,
  })
}

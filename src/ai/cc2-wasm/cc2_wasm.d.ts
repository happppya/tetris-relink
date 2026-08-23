/* tslint:disable */
/* eslint-disable */
export function cc2_our_x(piece: string, rotation: number, cc_x: number): number;
export function cc2_plan_x(piece: string, rotation: number, our_x: number): number;
export class Cc2Bot {
  free(): void;
  /**
   * `config_json` mirrors cold-clear-2's BotConfig serde shape; empty string uses defaults.
   */
  constructor(config_json: string);
  /**
   * Report that the planned placement for `piece` was played.
   *
   * The placement is matched against the last suggest() output and replayed
   * verbatim; synthesizing one here (without the landing row/spin the DAG
   * expanded with) would panic inside cold-clear-2's child lookup.
   */
  play(piece: string, rotation: number, our_x: number): void;
  /**
   * Run a bounded amount of search work on the calling thread.
   */
  pump(iterations: number): bigint;
  stop(): void;
  /**
   * Begin a fresh search. `board_cols[c]` bit y set = filled cell at column c, row y
   * counted from the bottom. `queue` is the visible upcoming pieces after `current`.
   * `hold` is the reserve piece (null = empty hold slot); cc2 only uses it as an
   * evaluation hint — hold swaps are decided by the embedder via branch comparison.
   */
  start(board_cols: Uint32Array, current: string, queue: string[], combo: number, back_to_back: boolean, hold?: string | null): void;
  /**
   * Best plan as a JSON array of `{ "type", "rot", "x", "spin", "eval" }` in caller
   * convention plus `"cells"`: the four occupied `[col, row]` pairs, row 0 =
   * board bottom, so the caller can verify/execute the exact placement.
   * `eval` is the search's score for the placement; values are only
   * comparable within searches run with the same config and budget.
   */
  suggest(): string | undefined;
  new_piece(piece: string): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_cc2bot_free: (a: number, b: number) => void;
  readonly cc2_our_x: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly cc2_plan_x: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly cc2bot_new: (a: number, b: number) => [number, number, number];
  readonly cc2bot_new_piece: (a: number, b: number, c: number) => [number, number];
  readonly cc2bot_play: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly cc2bot_pump: (a: number, b: number) => bigint;
  readonly cc2bot_start: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number];
  readonly cc2bot_stop: (a: number) => void;
  readonly cc2bot_suggest: (a: number) => [number, number];
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

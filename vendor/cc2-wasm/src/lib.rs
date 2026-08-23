//! wasm-bindgen wrapper around the cold-clear-2 bot.
//!
//! Coordinate conventions: the wrapper accepts/plans in the *caller's*
//! convention (rotation = clockwise steps from spawn, x = matrix origin as
//! used by tetris-liberation's `cellsFor`) and converts to/from cold-clear-2's
//! center-based locations internally.

use cold_clear_2::bot::{Bot, BotConfig, BotOptions};
use cold_clear_2::data::{Board, GameState, Piece, Placement, Rotation, Spin};
use cold_clear_2::sync::BotSyncronizer;
use enumset::EnumSet;
use std::cell::RefCell;
use std::sync::Arc;
use wasm_bindgen::prelude::*;

fn parse_piece(s: &str) -> Result<Piece, JsValue> {
    match s {
        "I" => Ok(Piece::I),
        "O" => Ok(Piece::O),
        "T" => Ok(Piece::T),
        "L" => Ok(Piece::L),
        "J" => Ok(Piece::J),
        "S" => Ok(Piece::S),
        "Z" => Ok(Piece::Z),
        other => Err(JsValue::from_str(&format!("unknown piece: {other}"))),
    }
}

fn rotation_from_idx(idx: u8) -> Rotation {
    match idx {
        0 => Rotation::North,
        1 => Rotation::East,
        2 => Rotation::South,
        _ => Rotation::West,
    }
}

fn idx_from_rotation(r: Rotation) -> u8 {
    match r {
        Rotation::North => 0,
        Rotation::East => 1,
        Rotation::South => 2,
        Rotation::West => 3,
    }
}

/// Cells in tetris-liberation's convention (matrix origin at x=0).
fn our_cells(piece: Piece, rot_idx: u8) -> [(i8, i8); 4] {
    let mut cells = match piece {
        Piece::I => [(0i8, 1i8), (1, 1), (2, 1), (3, 1)],
        Piece::O => [(0, 0), (1, 0), (0, 1), (1, 1)],
        Piece::T => [(1, 0), (0, 1), (1, 1), (2, 1)],
        Piece::L => [(2, 0), (0, 1), (1, 1), (2, 1)],
        Piece::J => [(0, 0), (0, 1), (1, 1), (2, 1)],
        Piece::S => [(1, 0), (2, 0), (0, 1), (1, 1)],
        Piece::Z => [(0, 0), (1, 0), (1, 1), (2, 1)],
    };
    let n: i8 = match piece {
        Piece::I => 4,
        Piece::O => 2,
        _ => 3,
    };
    for _ in 0..(rot_idx % 4) {
        cells = cells.map(|(x, y)| (n - 1 - y, x));
    }
    cells
}

fn our_min_dx(piece: Piece, rot_idx: u8) -> i8 {
    our_cells(piece, rot_idx).iter().map(|c| c.0).min().unwrap_or(0)
}

// NOTE: cc2's own cell offsets differ from ours; compute cc min from its table.
fn cc_cells(piece: Piece, rot_idx: u8) -> [(i8, i8); 4] {
    // mirror of data.rs Piece::cells + Rotation::rotate_cell for North base
    let north: [(i8, i8); 4] = match piece {
        Piece::I => [(-1, 0), (0, 0), (1, 0), (2, 0)],
        Piece::O => [(0, 0), (1, 0), (0, 1), (1, 1)],
        Piece::T => [(-1, 0), (0, 0), (1, 0), (0, 1)],
        Piece::L => [(-1, 0), (0, 0), (1, 0), (1, 1)],
        Piece::J => [(-1, 0), (0, 0), (1, 0), (-1, 1)],
        Piece::S => [(-1, 0), (0, 0), (0, 1), (1, 1)],
        Piece::Z => [(-1, 1), (0, 1), (0, 0), (1, 0)],
    };
    let r = rotation_from_idx(rot_idx);
    north.map(|(x, y)| r.rotate_cell((x, y)))
}

#[wasm_bindgen]
pub fn cc2_plan_x(piece: &str, rotation: u8, our_x: i8) -> Result<i8, JsValue> {
    let p = parse_piece(piece)?;
    Ok(cc2_plan_x_internal(p, rotation, our_x))
}

#[wasm_bindgen]
pub fn cc2_our_x(piece: &str, rotation: u8, cc_x: i8) -> Result<i8, JsValue> {
    let p = parse_piece(piece)?;
    Ok(cc_x + cc_min_dx_real(p, rotation) - our_min_dx(p, rotation))
}

fn cc_min_dx_real(piece: Piece, rot_idx: u8) -> i8 {
    cc_cells(piece, rot_idx).iter().map(|c| c.0).min().unwrap_or(0)
}

#[wasm_bindgen]
pub struct Cc2Bot {
    sync: Arc<BotSyncronizer>,
    config: Arc<BotConfig>,
    started: bool,
    /// Candidates returned by the last suggest(); advance() must replay one of
    /// them verbatim (landing y and spin included) or the DAG lookup panics.
    last_plan: RefCell<Vec<Placement>>,
}

#[wasm_bindgen]
impl Cc2Bot {
    /// `config_json` mirrors cold-clear-2's BotConfig serde shape; empty string uses defaults.
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str) -> Result<Cc2Bot, JsValue> {
        let config: BotConfig = if config_json.trim().is_empty() {
            BotConfig::default()
        } else {
            serde_json::from_str(config_json)
                .map_err(|e| JsValue::from_str(&format!("bad bot config: {e}")))?
        };
        Ok(Cc2Bot {
            sync: Arc::new(BotSyncronizer::new()),
            config: Arc::new(config),
            started: false,
            last_plan: RefCell::new(Vec::new()),
        })
    }

    /// Begin a fresh search. `board_cols[c]` bit y set = filled cell at column c, row y
    /// counted from the bottom. `queue` is the visible upcoming pieces after `current`.
    /// `hold` is the reserve piece (null = empty hold slot); cc2 only uses it as an
    /// evaluation hint — hold swaps are decided by the embedder via branch comparison.
    pub fn start(
        &mut self,
        board_cols: &[u32],
        current: &str,
        queue: Vec<String>,
        combo: u32,
        back_to_back: bool,
        hold: Option<String>,
    ) -> Result<(), JsValue> {
        if board_cols.len() < 10 {
            return Err(JsValue::from_str("board_cols must have 10 entries"));
        }
        let current = parse_piece(current)?;
        let hold = match hold.as_deref() {
            Some(s) => Some(parse_piece(s)?),
            None => None,
        };
        let mut q = Vec::with_capacity(queue.len() + 1);
        // cc2 pins its root search layer to queue[0] (the falling piece);
        // `reserve` mirrors its hold slot.
        q.push(current);
        for s in &queue {
            q.push(parse_piece(s)?);
        }
        let mut cols = [0u64; 10];
        for i in 0..10 {
            cols[i] = board_cols[i] as u64;
        }
        let state = GameState {
            reserve: hold.unwrap_or(current),
            // the caller always knows the exact falling piece, so pin the root
            // search layer to it instead of hedging over the whole bag
            bag: EnumSet::only(current),
            back_to_back,
            combo: combo.try_into().unwrap_or(u8::MAX),
            board: Board { cols },
        };
        self.sync.stop();
        let bot = Bot::new(
            BotOptions {
                speculate: false,
                config: self.config.clone(),
            },
            state,
            &q,
        );
        self.sync.start(bot);
        self.last_plan.borrow_mut().clear();
        self.started = true;
        Ok(())
    }

    /// Report that the planned placement for `piece` was played.
    ///
    /// The placement is matched against the last suggest() output and replayed
    /// verbatim; synthesizing one here (without the landing row/spin the DAG
    /// expanded with) would panic inside cold-clear-2's child lookup.
    pub fn play(&self, piece: &str, rotation: u8, our_x: i8) -> Result<(), JsValue> {
        let p = parse_piece(piece)?;
        let cc_x = cc2_plan_x_internal(p, rotation, our_x);
        let wanted = (
            p,
            rotation_from_idx(rotation),
            cc_x,
        );
        let plan = self.last_plan.borrow();
        let mv = plan
            .iter()
            .find(|mv| {
                (
                    mv.location.piece,
                    mv.location.rotation,
                    mv.location.x,
                ) == wanted
            })
            .ok_or_else(|| {
                JsValue::from_str("played placement was not part of the current suggestion")
            })?;
        self.sync.advance(*mv);
        Ok(())
    }

    pub fn new_piece(&self, piece: &str) -> Result<(), JsValue> {
        self.sync.new_piece(parse_piece(piece)?);
        Ok(())
    }

    /// Run a bounded amount of search work on the calling thread.
    pub fn pump(&self, iterations: usize) -> u64 {
        if !self.started {
            return 0;
        }
        self.sync.pump_work(iterations)
    }

    /// Best plan as a JSON array of `{ "type", "rot", "x", "spin", "eval" }` in caller
    /// convention plus `"cells"`: the four occupied `[col, row]` pairs, row 0 =
    /// board bottom, so the caller can verify/execute the exact placement.
    /// `eval` is the search's score for the placement; values are only
    /// comparable within searches run with the same config and budget.
    pub fn suggest(&self) -> Option<String> {
        if !self.started {
            return None;
        }
        let (moves, _) = self.sync.suggest()?;
        *self.last_plan.borrow_mut() = moves.iter().map(|&(mv, _)| mv).collect();
        let out: Vec<serde_json::Value> = moves
            .iter()
            .map(|&(mv, eval)| {
                let piece = mv.location.piece;
                let rot = idx_from_rotation(mv.location.rotation);
                let spin = match mv.spin {
                    Spin::None => "none",
                    Spin::Mini => "mini",
                    Spin::Full => "full",
                };
                serde_json::json!({
                    "type": piece_name(piece),
                    "rot": rot,
                    "x": cc2_our_x_internal(piece, rot, mv.location.x),
                    "spin": spin,
                    "cells": mv.location.cells(),
                    "eval": eval,
                })
            })
            .collect();
        Some(serde_json::to_string(&out).ok()?)
    }

    pub fn stop(&mut self) {
        self.sync.stop();
        self.last_plan.borrow_mut().clear();
        self.started = false;
    }
}

// our origin + our min cell offset == cc origin + cc min cell offset
fn cc2_plan_x_internal(p: Piece, rotation: u8, our_x: i8) -> i8 {
    our_x + our_min_dx(p, rotation) - cc_min_dx_real(p, rotation)
}

fn cc2_our_x_internal(p: Piece, rotation: u8, cc_x: i8) -> i8 {
    cc_x + cc_min_dx_real(p, rotation) - our_min_dx(p, rotation)
}

fn piece_name(p: Piece) -> &'static str {
    match p {
        Piece::I => "I",
        Piece::O => "O",
        Piece::T => "T",
        Piece::L => "L",
        Piece::J => "J",
        Piece::S => "S",
        Piece::Z => "Z",
    }
}

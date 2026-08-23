// std::time::Instant is unavailable on wasm32-unknown-unknown (it would import
// `env.now`); timing here only feeds cosmetic nps stats, so stub it out on wasm.
#[cfg(not(target_arch = "wasm32"))]
use std::time::{Duration, Instant};

#[cfg(target_arch = "wasm32")]
#[derive(Copy, Clone, Debug)]
struct Instant;
#[cfg(target_arch = "wasm32")]
impl Instant {
    fn now() -> Self {
        Instant
    }
    fn elapsed(&self) -> Duration {
        Duration::from_secs(1)
    }
}
#[cfg(target_arch = "wasm32")]
use std::time::Duration;

use parking_lot::{Condvar, Mutex, RwLock};

use crate::bot::{Bot, Statistics};
use crate::data::{Piece, Placement};
use crate::tbp::MoveInfo;

pub struct BotSyncronizer {
    state: Mutex<State>,
    blocker: Condvar,
    bot: RwLock<Option<Bot>>,
}

impl BotSyncronizer {
    pub fn new() -> Self {
        BotSyncronizer {
            state: Mutex::new(State {
                stats: Default::default(),
                last_advance: Instant::now(),
                node_limit: u64::MAX,
                start: Instant::now(),
                nodes_since_start: 0,
            }),
            blocker: Condvar::new(),
            bot: RwLock::new(None),
        }
    }

    pub fn start(&self, initial_state: Bot) {
        let mut state = self.state.lock();
        state.stats = Default::default();
        state.nodes_since_start = 0;
        state.start = Instant::now();
        *self.bot.write() = Some(initial_state);
        self.blocker.notify_all();
    }

    pub fn stop(&self) {
        *self.bot.write() = None;
    }

    pub fn suggest(&self) -> Option<(Vec<(Placement, f64)>, MoveInfo)> {
        let bot = self.bot.read();
        bot.as_ref().map(|bot| {
            let state = self.state.lock();
            let suggestion = bot.suggest();
            let info = MoveInfo {
                nodes: state.stats.nodes,
                nps: state.stats.nodes as f64 / state.last_advance.elapsed().as_secs_f64(),
                extra: format!(
                    "{:.1}% of selections expanded, overall speed: {:.1} Mnps",
                    state.stats.expansions as f64 / state.stats.selections as f64 * 100.0,
                    state.nodes_since_start as f64 / state.start.elapsed().as_secs_f64() / 1_000_000.0
                )
            };
            (suggestion, info)
        })
    }

    /// Cooperatively run a bounded amount of bot work; used on wasm32 where
    /// background threads are unavailable.
    pub fn pump_work(&self, iterations: usize) -> u64 {
        let mut total = 0u64;
        let mut state = self.state.lock();
        let bot_guard = self.bot.read();
        if let Some(bot) = &*bot_guard {
            for _ in 0..iterations {
                if state.stats.nodes > 50_000_000 {
                    break;
                }
                let new_stats = bot.do_work();
                total += new_stats.nodes;
                state.stats.accumulate(new_stats);
                state.nodes_since_start += new_stats.nodes;
            }
        }
        drop(bot_guard);
        total
    }

    pub fn advance(&self, mv: Placement) {
        let mut state = self.state.lock();
        state.stats = Default::default();
        state.last_advance = Instant::now();
        let mut bot = self.bot.write();
        if let Some(bot) = &mut *bot {
            bot.advance(mv);
        }
        self.blocker.notify_all();
    }

    pub fn new_piece(&self, piece: Piece) {
        let mut bot = self.bot.write();
        if let Some(bot) = &mut *bot {
            bot.new_piece(piece);
        }
        self.blocker.notify_all();
    }

    pub fn work_loop(&self) {
        let mut state = self.state.lock();
        loop {
            if state.stats.nodes > state.node_limit {
                self.blocker.wait(&mut state);
                continue;
            }
            let bot_guard = self.bot.read();
            let bot = match &*bot_guard {
                Some(bot) => bot,
                None => {
                    drop(bot_guard);
                    self.blocker.wait(&mut state);
                    continue;
                }
            };

            drop(state);
            let new_stats = bot.do_work();
            drop(bot_guard);

            state = self.state.lock();
            state.stats.accumulate(new_stats);
            state.nodes_since_start += new_stats.nodes;
        }
    }
}

#[derive(Copy, Clone, Debug)]
struct State {
    stats: Statistics,
    last_advance: Instant,
    node_limit: u64,
    start: Instant,
    nodes_since_start: u64,
}

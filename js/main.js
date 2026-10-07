// ============================================================
// 主入口 - 游戏初始化
// ============================================================

let game;
let gameUI;

window.addEventListener('DOMContentLoaded', () => {
    // 初始化游戏核心
    game = new GameCore();

    // 测试期统计：只依赖浏览器自带能力，失败不影响游戏
    let analytics = null;
    try {
        analytics = new Analytics({
            storage: window.localStorage,
            gtag: typeof window.gtag === 'function' ? window.gtag : null,
            doNotTrack: navigator.doNotTrack === '1' || window.doNotTrack === '1',
        });
        game.analytics = analytics;
    } catch (e) { console.warn('统计初始化失败:', e); }

    // 尝试加载存档（主存档损坏时自动尝试备份）
    let loaded = false;
    try {
        loaded = game.load();
    } catch (e) {
        console.warn('加载存档异常:', e);
    }
    const loadReport = game.loadReport;
    if (!loaded) {
        game.initNewGame();
    }

    if (analytics) {
        analytics.startSession({ new_player: !loaded });
        // 这次安装的第一次操作（点击/触摸/按键）
        const firstAction = (e) => {
            const tab = e.target && e.target.closest ? e.target.closest('[data-tab]') : null;
            analytics.once('first_action', { via: e.type, tab: tab ? tab.dataset.tab : 'none' });
        };
        for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, firstAction, { once: true, capture: true });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) analytics.onHidden();
            else analytics.onVisible();
        });
        window.addEventListener('pagehide', () => analytics.endSession('pagehide'));
    }

    // 初始化UI
    gameUI = new GameUI(game);

    // 初次渲染
    gameUI.renderTeam();
    gameUI.showLoadReport(loadReport);

    // 离线结算：页面加载时如果距离上次保存超过2秒，自动执行离线战斗
    if (loaded && game.gameState && game.gameState.lastSave) {
        const elapsed = Date.now() - game.gameState.lastSave;
        if (elapsed > 2000) {
            const cappedElapsed = Math.min(elapsed, game.getMaxOfflineTime());
            // 不用 requestAnimationFrame：后台标签页不会触发它
            setTimeout(() => { game._processOfflineBattles(cappedElapsed); }, 0);
        }
    }

    // 新手引导（只弹一次）
    try {
        if (!localStorage.getItem('pokemon_idle_tutorial_done')) {
            gameUI.showTutorialDialog(() => {
                localStorage.setItem('pokemon_idle_tutorial_done', '1');
            });
        }
    } catch (e) { /* 隐私模式下 localStorage 可能不可用 */ }

    // 开始战斗
    game.startBattle();

    // 开始自动保存
    game.startAutoSave();

    // 启动树果倒计时刷新
    gameUI.startBerryTimer();

    console.log('🎮 宝可梦挂机放置游戏已启动！');
});

// 页面关闭前立即保存（防抖中的变更不能丢）
window.addEventListener('beforeunload', () => {
    if (game) {
        game.saveNow();
    }
});

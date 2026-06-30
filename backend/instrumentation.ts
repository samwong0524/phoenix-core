export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startSkillWatcher } = await import('./src/runtime/skill-watcher');
    startSkillWatcher();
  }
}

type IntervalProvider = () => { runningSeconds: number; idleSeconds: number };

export class RefreshController {
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(
    private readonly refreshFn: () => Promise<boolean>,
    private readonly intervalProvider: IntervalProvider
  ) {}

  start(): void {
    this.stop();
    this.schedule(0);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private schedule(delayMs: number): void {
    if (this.disposed) {
      return;
    }
    this.timer = setTimeout(async () => {
      let anyRunning = false;
      try {
        anyRunning = await this.refreshFn();
      } catch (error) {
        console.error('Gitea Actions refresh failed', error);
      }
      const { runningSeconds, idleSeconds } = this.intervalProvider();
      const nextDelay = (anyRunning ? runningSeconds : idleSeconds) * 1000;
      this.schedule(nextDelay);
    }, delayMs);
  }
}

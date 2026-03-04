import type { MetaDAL } from "../storage/meta.js";
import type { SpoolDAL } from "../storage/spool.js";

const GC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const GC_MAX_AGE_HOURS = 168; // 7 days

export class SpoolGarbageCollector {
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private spoolDal: SpoolDAL,
		private metaDal: MetaDAL,
	) {}

	start(): void {
		if (this.timer !== null) return;
		this.timer = setInterval(() => this.collect(), GC_INTERVAL_MS);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	collect(): void {
		// Delete output chunks older than GC_MAX_AGE_HOURS
		const cutoff = new Date(Date.now() - GC_MAX_AGE_HOURS * 3600 * 1000).toISOString();
		this.spoolDal.deleteChunksOlderThan(cutoff);

		// Run PRAGMA incremental_vacuum to reclaim freed pages
		this.spoolDal.incrementalVacuum();
	}
}

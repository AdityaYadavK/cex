enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

class Logger {
    private level: LogLevel;

    constructor() {
        const envLevel = process.env.LOG_LEVEL?.toUpperCase() || "INFO";
        this.level = LogLevel[envLevel as keyof typeof LogLevel] ?? LogLevel.INFO;
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.level;
    }

    debug(message: string, ...args: any[]) {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
        }
    }

    info(message: string, ...args: any[]) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.info(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
        }
    }

    warn(message: string, ...args: any[]) {
        if (this.shouldLog(LogLevel.WARN)) {
            console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
        }
    }

    error(message: string, error?: Error | unknown, ...args: any[]) {
        if (this.shouldLog(LogLevel.ERROR)) {
            console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error, ...args);
        }
    }
}

export const logger = new Logger();
export class AppError extends Error {
    code: number;

    constructor(message: string, code: number) {
        super(message);
        this.name = "AppError";
        this.code = code;
    }
}

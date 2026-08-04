export class AppError extends Error
{
    statusCode: number;
    constructor(statusCode: number = 500, message: string = "Internal Server Error")
    {
        super();
        this.statusCode = statusCode;
        this.message = message;
    }
}

// Bad Request
export class ValidationError extends AppError
{
    constructor(message: string = "Bad Reuqest/Invalid Inputs")
    {
        super();
        this.statusCode = 400;
        this.message = message;
    }
}

// 401 Unauthorised
export class Unauthorised extends AppError
{
    constructor(message: string = "User Unauthorised")
    {
        super();
        this.message = message;
        this.statusCode = 401;
    }
}


// 403 Forbidden
export class Forbidden extends AppError
{
    constructor(message: string = "Not Allowed")
    {
        super();
        this.message = message;
        this.statusCode = 403;
    }
}


// 404 Not Found
export class Not_Found extends AppError
{
    constructor(message: string = "User Not Found")
    {
        super();
        this.message = message;
        this.statusCode = 404;
    }
}



// 409 Conflict
export class Duplicate extends AppError
{
    constructor(message: string = "Data already Exists")
    {
        super();
        this.message = message;
        this.statusCode = 409;
    }
}


// 429 Too Many Requests
export class Rate_Limit extends AppError
{
    constructor(message: string = "Too Many Requests")
    {
        super();
        this.message = message;
        this.statusCode = 429;
    }
}

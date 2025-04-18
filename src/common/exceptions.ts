export class BadRequestException extends Error {
  status: number;
  constructor(message: string = 'Bad request', status: number = 400) {
    super(message);
    this.name = 'BadRequestException';
    this.status = status;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InternalServerErrorException extends Error {
  status: number;
  constructor(message: string = 'Internal server error', status: number = 500) {
    super(message);
    this.name = 'InternalServerErrorException';
    this.status = status;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundException extends Error {
  status: number;
  constructor(message: string = 'Resource not found', status: number = 404) {
    super(message);
    this.name = 'NotFoundException';
    this.status = status;
    Error.captureStackTrace(this, this.constructor);
  }
}

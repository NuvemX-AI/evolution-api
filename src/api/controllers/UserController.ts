import { Request, Response } from 'express';

export class UserController {
  static async create(req: Request, res: Response) {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Missing name or email' });
    }

    return res.status(201).json({
      message: 'User created',
      data: { name, email },
    });
  }
}

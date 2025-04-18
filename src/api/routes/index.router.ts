import { Router } from 'express';
import { instanceController } from '../server.module';

const router: Router = Router();

router.get('/', (req, res) => {
  res.json({ status: 200, message: '🚀 NuvemX Backend is running (minimal mode).' });
});

router.post('/instance/create', async (req, res, next) => {
  try {
    const data = await instanceController.createInstance(req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post('/instance/connect', async (req, res, next) => {
  try {
    const data = await instanceController.connectToWhatsapp(req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get('/instance/connectionState/:instanceName', async (req, res, next) => {
  try {
    const data = await instanceController.connectionState(req.params);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export { router };

import { OfferCallDto } from '../dto/call.dto';
import { InstanceDto } from '../dto/instance.dto';
import { WAMonitoringService } from '../services/monitor.service';

export class CallController {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  public async offerCall({ instanceName }: InstanceDto, data: OfferCallDto) {
    return await this.waMonitor.waInstances[instanceName].offerCall(data);
  }
}

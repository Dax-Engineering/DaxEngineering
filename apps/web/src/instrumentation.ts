import { serverMonitoring } from '@dax/web-data-access/monitoring';

export const { register, onRequestError } = serverMonitoring('web');

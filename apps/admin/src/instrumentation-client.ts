import {
  MONITORING_ELEMENT_ID,
  startBrowserMonitoring,
} from '@dax/web-data-access/monitoring-client';

startBrowserMonitoring(
  document.getElementById(MONITORING_ELEMENT_ID)?.textContent,
);

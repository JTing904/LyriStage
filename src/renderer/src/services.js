// 把 core 里的模块按当前平台的配置组装好，界面直接 import 这里
import { createHttp } from '@core/http/client';
import { createNetease } from '@core/netease';
import { apiBase } from './platform';

export const http = createHttp({ baseURL: apiBase });
export const netease = createNetease(http);

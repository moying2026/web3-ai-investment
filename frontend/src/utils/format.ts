/**
 * 数字格式化工具 — 禁止科学计数法
 *
 * 规则：
 * - 小数：保留合理位数（如 0.00001234）
 * - 大数：用千分位分隔（如 1,234,567）
 * - 禁止：1.23e-5、4.56e+8 这种科学计数法
 */

/**
 * 格式化数字，禁止科学计数法，支持千分位
 * @param value 输入值（string | number | null | undefined）
 * @param options 配置项
 * @returns 格式化后的字符串
 */
export function formatNumber(
  value: string | number | null | undefined,
  options?: {
    /** 小数位数（仅对 |v| >= 1 生效），默认 2 */
    decimals?: number;
    /** 是否显示千分位，默认 true */
    useGrouping?: boolean;
    /** 前缀（如 "$"） */
    prefix?: string;
    /** 后缀（如 "%"） */
    suffix?: string;
  }
): string {
  if (value == null || value === '') return '-';

  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return '-';

  const {
    decimals = 2,
    useGrouping = true,
    prefix = '',
    suffix = '',
  } = options || {};

  let formatted: string;

  if (num === 0) {
    formatted = '0';
  } else if (Math.abs(num) >= 1) {
    // 大数：用 Intl.NumberFormat 千分位
    const fmt = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
      useGrouping,
    });
    formatted = fmt.format(num);
    // 兜底：如果仍含 e（极端大数），用字符串方式
    if (formatted.includes('e') || formatted.includes('E')) {
      formatted = avoidScientific(num);
    }
  } else {
    // 0 < |num| < 1：找出第一个有效数字位，保留合理精度
    formatted = formatSmallNumber(num);
  }

  return `${prefix}${formatted}${suffix}`;
}

/**
 * 格式化价格（带 $ 前缀）
 * 小价格保留到第一个有效数字（如 $0.00001234）
 * 大价格千分位 + 2 位小数（如 $1,234,567.89）
 */
export function formatPrice(value: string | number | null | undefined): string {
  if (value == null || value === '') return '-';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return '-';

  if (num === 0) return '$0';

  if (Math.abs(num) >= 1) {
    const fmt = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
      useGrouping: true,
    });
    const result = fmt.format(num);
    if (!result.includes('e') && !result.includes('E')) return result;
  }

  // 小价格或兜底
  return `$${formatSmallNumber(num)}`;
}

/**
 * 格式化百分比（带 + / - 号和 % 后缀）
 */
export function formatPercent(value: string | number | null | undefined): string {
  if (value == null || value === '') return '-';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return '-';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

/**
 * 格式化金额（成交量、流动性、市值等）：大数用 M/K 缩写，小数千分位
 */
export function formatVolume(value: string | number | null | undefined): string {
  if (value == null || value === '') return '-';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num) || num === 0) return '$0';

  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

/**
 * 格式化供应量（大数用 B/M/K 缩写，千分位）
 */
export function formatSupply(value: string | number | null | undefined): string {
  if (value == null || value === '') return '-';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num) || num === 0) return '0';

  if (num >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(0)}K`;
  return num.toLocaleString('en-US');
}

// ========== 内部工具函数 ==========

/**
 * 格式化 0 < |num| < 1 的小数
 * 找到第一个非零数字位，保留到第一个有效数字后 4 位
 * 例如：0.00001234 → "0.00001234"，0.00000000005678 → "0.00000000005678"
 */
function formatSmallNumber(num: number): string {
  const absStr = Math.abs(num).toFixed(20); // 先展开到足够位数
  const absNoTrailing = absStr.replace(/0+$/, '');

  // 找小数点后第一个非零位的位置
  const decPart = absNoTrailing.split('.')[1] || '';
  let firstNonZero = -1;
  for (let i = 0; i < decPart.length; i++) {
    if (decPart[i] !== '0') {
      firstNonZero = i;
      break;
    }
  }

  if (firstNonZero === -1) return '0';

  // 保留到第一个有效数字后 4 位（至少 8 位小数，最多 18 位）
  const keepDecimals = Math.min(18, Math.max(8, firstNonZero + 4));
  const raw = Math.abs(num).toFixed(keepDecimals);

  // 去掉末尾多余的 0，但至少保留到第一个有效数字
  const trimmed = raw.replace(/0+$/, '');
  const result = num < 0 ? `-${trimmed}` : trimmed;

  // 兜底检查：如果结果包含 e（理论上不会），用字符串方式处理
  if (result.includes('e') || result.includes('E')) {
    return avoidScientific(num);
  }

  return result;
}

/**
 * 兜底：用字符串操作避免科学计数法
 * 用于 toFixed() 仍然返回 e 格式的极端情况
 */
function avoidScientific(num: number): string {
  const str = String(num);
  if (!str.includes('e') && !str.includes('E')) return str;

  const sign = num < 0 ? '-' : '';
  const parts = str.replace('-', '').split(/[eE]/);
  const mantissa = Number(parts[0]);
  const exp = Number(parts[1]);

  const mantissaStr = mantissa.toString().replace('.', '');
  const mantissaDecimals = (mantissa.toString().split('.')[1] || '').length;

  if (exp >= 0) {
    // 大数
    const totalDecimals = mantissaDecimals - exp;
    if (totalDecimals <= 0) {
      return sign + mantissaStr + '0'.repeat(-totalDecimals);
    }
    const intPart = mantissaStr.slice(0, mantissaStr.length - totalDecimals) || '0';
    const decPart = mantissaStr.slice(mantissaStr.length - totalDecimals);
    return sign + intPart + '.' + decPart;
  } else {
    // 小数
    const zeros = '0'.repeat(Math.abs(exp) - 1);
    return sign + '0.' + zeros + mantissaStr;
  }
}

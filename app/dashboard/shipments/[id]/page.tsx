/**
 * Shipment Detail Page
 * 3 tabs: Bekleyen (pending) | Gönderilenler (sent) | Koliler (boxes, sea only)
 * Sea: box entry + sevkiyat kapat
 * Road/air: checkbox + parti gonderi
 */

'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft, Plus, Send, Loader2, AlertCircle, Pencil,
  Package, Calendar, Anchor, Truck as TruckIcon, Plane,
  Check, Square, CheckSquare, Download, Ship, X, ChevronDown, ChevronRight, Printer, Search, Copy, RefreshCw,
} from 'lucide-react';

// --- Types ---
interface ShipmentItem {
  id: string; iwasku: string; quantity: number; desi: number | null;
  marketplaceId: string | null;
  marketplace: { id: string; name: string; code: string } | null;
  productName: string; productCategory: string; fnsku: string | null;
  reserveId: string | null; packed: boolean; sentAt: string | null; createdAt: string;
}
interface ShipmentBox {
  id: string; shipmentItemId: string | null; boxNumber: string;
  iwasku: string | null; fnsku: string | null;
  productName: string | null; productCategory: string | null;
  marketplaceCode: string | null; destination: string;
  quantity: number; width: number | null; height: number | null;
  depth: number | null; weight: number | null; labelPrinted: boolean; createdAt: string;
}
interface ShipmentDetail {
  id: string; name: string; destinationTab: string; shippingMethod: string;
  plannedDate: string; actualDate: string | null; etaDate: string | null;
  status: string; notes: string | null; items: ShipmentItem[];
}
interface BoxFormData {
  iwasku?: string | null; fnsku?: string | null; productName?: string | null;
  productCategory?: string | null; marketplaceCode?: string | null;
  destination?: string;
  quantity: number; width?: number | null; height?: number | null;
  depth?: number | null; weight?: number | null;
}

const methodIcons: Record<string, typeof Anchor> = { sea: Anchor, road: TruckIcon, air: Plane };
const methodLabels: Record<string, string> = { sea: 'Deniz', road: 'Karayolu', air: 'Hava' };
const BOX_ENTRY_METHODS = new Set(['sea']);
const loadXLSX = () => import('xlsx');

// GPSR etiket asset'leri (base64 PNG)
const GPSR_LOGO_B64 = 'data:image/png;base64,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';
const GPSR_EURP_B64 = 'data:image/png;base64,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';
const GPSR_SYMBOLS_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJsAAAAoCAYAAADpP4hXAAAEAmlDQ1BJQ0MgUHJvZmlsZQAAeJyNVV1oHFUUPpu5syskzoPUpqaSDv41lLRsUtGE2uj+ZbNt3CyTbLRBkMns3Z1pJjPj/KRpKT4UQRDBqOCT4P9bwSchaqvtiy2itFCiBIMo+ND6R6HSFwnruTOzu5O4a73L3PnmnO9+595z7t4LkLgsW5beJQIsGq4t5dPis8fmxMQ6dMF90A190C0rjpUqlSYBG+PCv9rt7yDG3tf2t/f/Z+uuUEcBiN2F2Kw4yiLiZQD+FcWyXYAEQfvICddi+AnEO2ycIOISw7UAVxieD/Cyz5mRMohfRSwoqoz+xNuIB+cj9loEB3Pw2448NaitKSLLRck2q5pOI9O9g/t/tkXda8Tbg0+PszB9FN8DuPaXKnKW4YcQn1Xk3HSIry5ps8UQ/2W5aQnxIwBdu7yFcgrxPsRjVXu8HOh0qao30cArp9SZZxDfg3h1wTzKxu5E/LUxX5wKdX5SnAzmDx4A4OIqLbB69yMesE1pKojLjVdoNsfyiPi45hZmAn3uLWdpOtfQOaVmikEs7ovj8hFWpz7EV6mel0L9Xy23FMYlPYZenAx0yDB1/PX6dledmQjikjkXCxqMJS9WtfFCyH9XtSekEF+2dH+P4tzITduTygGfv58a5VCTH5PtXD7EFZiNyUDBhHnsFTBgE0SQIA9pfFtgo6cKGuhooeilaKH41eDs38Ip+f4At1Rq/sjr6NEwQqb/I/DQqsLvaFUjvAx+eWirddAJZnAj1DFJL0mSg/gcIpPkMBkhoyCSJ8lTZIxk0TpKDjXHliJzZPO50dR5ASNSnzeLvIvod0HG/mdkmOC0z8VKnzcQ2M/Yz2vKldduXjp9bleLu0ZWn7vWc+l0JGcaai10yNrUnXLP/8Jf59ewX+c3Wgz+B34Df+vbVrc16zTMVgp9um9bxEfzPU5kPqUtVWxhs6OiWTVW+gIfywB9uXi7CGcGW/zk98k/kmvJ95IfJn/j3uQ+4c5zn3Kfcd+AyF3gLnJfcl9xH3OfR2rUee80a+6vo7EK5mmXUdyfQlrYLTwoZIU9wsPCZEtP6BWGhAlhL3p2N6sTjRdduwbHsG9kq32sgBepc+xurLPW4T9URpYGJ3ym4+8zA05u44QjST8ZIoVtu3qE7fWmdn5LPdqvgcZz8Ww8BWJ8X3w0PhQ/wnCDGd+LvlHs8dRy6bLLDuKMaZ20tZrqisPJ5ONiCq8yKhYM5cCgKOu66Lsc0aYOtZdo5QCwezI4wm9J/v0X23mlZXOfBjj8Jzv3WrY5D+CsA9D7aMs2gGfjve8ArD6mePZSeCfEYt8CONWDw8FXTxrPqx/r9Vt4biXeANh8vV7/+/16ffMD1N8AuKD/A/8leAupObumAAAdSUlEQVR42u1ceVRV1ff/3PvuG0BGRYEcUMkRFRXKKbUwJf1qaIZj9lXTkm84sxTUjHLIiZxb9iUCh9QcKkVTwQFRDNNaDi2HRFOZUmYUeNO9+/dHndN78B6Dfqff8qx19XHvOeees88+e3/2cK6gKAoJggAAOJ1yGtdvXIMgiAAAAvDHE4BAf/7+684f/7K79Od9AYACQETVTggk/FWfIPBHf9SjP3ohAQIIigCIJPzZ3rKjZ+W/uQiCAEVR8Pzzz+PVV1/9c+kVCIqiUEFBASZMmIAHDx6gZcuWIKJnFHtW6l2ICKIo4n7mfTRwbIAdX+1As6bNIBARhYSEQKPR4KuvvoJGo3lGrWflqRRZkTHt3ffw6507OHU8GcKNGzdo2LBhuHjxIlxcXGA2myGK4jNKPStPVBQiSCoVTGYZnTr5YVtCPKS8vDy4uLhAp9OBiKBSqcAwXJ06VxTevt4D/LOPJ8EKdd0oRMTfa2ve7L4oivWiS23mrCgKAEAURYiiWCMd/lVjsUeb+tBX+LO9JAFuLi7Iys6BpFKprIhdn8VmOtpycWRZrhPjKYryb5WoRARZliFJUq3HKcvyU11oRiPLedeGbowBnjbDERFnMEEQoFKpqozFbDZDkqRaMBsBggCQCFIIKgmQGHPVd+CMuXJzc7F//35MnToVWq22yiCrYyZG4EOHDmHLli3QarVWO6qmIooi9Ho9Ro8ejbfffrvGBWPPJUmCoii4evUqfvrpJ1y7dg25ubkwGAxQq9Xw9PRE+/btERAQAH9/f45n67qR7DGMSqXCrVu3cPz4cQDAoEGDcPnyZWzZsgWurq588S2lzIABAxAeHs7bP03pxbQaW6fCwkKkpaUhPT0dOTk5iIiIgJ+fn5UkroW6AQkEEAFpaWnUrVs3MhgMRESkKArVtsiyTERE169fJ09PT/L29iZZlslsNtOaNWtoxYoVpCgK79teMZlMRET0ySef0J8+jnpdM2bMsOrP1njZmAsKCmjDhg3Uo0ePWvXt7+9Py5cvp+zs7Cp91bWYzWYiIjp06BC5ubnxd7i6utKWLVto9OjR1Y4lNjaWiIj0ej3vq7ZFURS+RrbGf+3aNVq3bh299tpr1LlzZ3rrrbcoISGBgoODqVevXrR69Wpe12g02uUXhf66HxAYSN998x09EbOZzWZSFIWuXLlCjRo1orfeeouIiFatWkUA6N133+V1b926ZZfpGHOsWbOGVCoVaTQaUqlUtb60Wi2pVCqaN2+eXWazJOzWrVupTZs2fPE8PT1pxIgRFB0dTXFxcfT111/Ttm3b6JNPPqGxY8dS8+bNed2mTZvShg0bOJ3qynCMSR88eEBeXl4EgDQaDUmSRACoQYMGdPToUerQoQNJkkRqtZrPk/329vam3Nxcm3Oz9057zJWTk0OHDh2i8PBw8vX1JQDk6+tLS5YsoXv37hERUXl5OS1fvpzu3btHbdu2paCgILpz5w7nAVv9KqQQ47fAwED6dv+39We2yjsqPz+f/z169Ci9/PLLdOLECXr8+DGFhYVRx44dqaKiwuY7GHOsXLmSAJBKpaqTRGMLFRERYZPZGDHKyspo0qRJvF1gYCB98cUXlJOTU+1cCwsLaefOndS7d2/eNiQkhM+5LtKF1Z02bRoBILVaXWUeQUFBtGnTJpu0YH+HhYXR9evXafXq1VReXk6KotRq7YqLi+ncuXO0du1aCgkJIVdXV973yJEj6fTp01xq/vDDD3Tz5k3Ky8vjtDUajdSnTx/S6XQUFxdXZQ3/Yra/SkBAAH377Tf1YzZWp6ysjIqKivjfSUlJ9PDhQ6u6P/30EwGgtm3bckloj9mYGq0vs82ZM6fKxNn7iouLaeDAgQSAHBwcaNWqVTYlrdFoJLPZTGazmUwmk9WuNRqNtHHjRmrRogVnViZhakM3xmhpaWkkSZJNRhIEgdq1a0cFBQXUr1+/KvQQBIFEUSSdTkc6nY7i4+OrZXhZlunq1au0e/dumj9/Pr3++usUEBBATZs2JXd3d+rRowdt2LCB8vLyiIjo7t27lJycTImJiXT06FHKyMigvLw8ioyMJEVR6McffyQiovHjxxMAGj58OP36669WKrpy+YPZ6iHZ2OKlpKRQt27d6PDhw2QwGGjYsGEEgG7fvk1ERJs3b6b4+Hgym820b98++uWXX+z2z5hj2bJlT8Rss2bNsupPURTOOCEhIVxlnjhxgtfbuHEjjR8/nubNm0cZGRk2x1gZdw4dOpS/u0+fPlRWVlYjhmN0q6iooD59+pAgCHalVmJiImdKURRJEAQSBKHKfAcPHmxXjTLmS0pKotDQUAoNDaU33niDhgwZQkOGDKGIiAhKS0sjWZapvLycLly4QAcPHqTvv/+eTpw4QadOnaLk5GS6ffs2FRQUcIjSv39/ev/994mIKCIigtN0y5YtdrVevZiNEUxRFOrYsSMBoNTUVCotLSWdTketWrUig8FAixcvJgA0f/583jYtLY3KysqqxWxLlix5qszGFmH58uUEgNzc3OjMmTNERGQwGGjcuHFW/Tz33HOUkZFRZYey3xUVFfTmm29ylcMwTk2GieWzrVu3VpFklnMODQ3l4yMiioyMtMKlkiSRJEnk6OjIN3B1GPXs2bM0e/ZsWrx4Mc2cOZPWrl1Lt2/fJlmW6d69e5ScnEwHDx6k5ORkOnXqFJ08eZJOnDhBJ0+epOTkZPrtt98oPz+fM9vrr79OAGjq1KlERLR27Vpyd3enxo0b05gxY+jatWtWeN6S2ers2DKbzRAEAXFxcYiLi0Pfvn3h7OyMW7duITU1FRqNBt26dcMrr7yCkSNHorCwEEFBQRgyZAg3te358p5mTJa5Wm7cuIHly5cDANasWYOXXnoJiqLg8uXL2LlzJyRJgkajgU6nQ05ODrZv384DyZb9lJWVYcyYMdi3bx/ef/997Nu3DzExMZAkCZ999hnS0tIgSRJkWbbrnlEUBa+99hpWrlyJJk2aQJZlEBHUajWICG5ublixYgV3JRmNRnTo0AGyLMNgMECWZZjNZvzjH/+An58fDAaDTb8Xc2V5enpCr9dzv+KMGTPg7OyMQ4cO4dq1a1CpVHB2drZyJjOXhl6vR1lZmZVbTK/XQ5IkxMbG4vXXX0d4eDg2b94MX19f3LlzB5MnT8aBAwcgimKV9ZTq6gBVq9UwGAzQarUwm82YOHEi7t27x6MHTk5O6NSpE6ZMmYJWrVrBbDbjhx9+QLt27aDVaqtlqKfJbKyvmJgYPH78GMHBwXjnnXdgNBqh0WhQWFjIF8VsNkOtVkMURZSUlFjNWaVSobi4GKNHj0ZSUhKioqKwfPlymEwmhISEYMyYMdixYwdWrFiBxMTEaqMQANCkSRPMmzcPo0ePxqefforY2FhUVFQAAKKiotC6dWuYTCZIkoTExER88803GDp0KGRZhizLMBqNcHFxQUREBABAq9UiPz8fDRs2hCAIVd7fsGFDODg48MX/7bff4ObmBldXV+4zZONjzvjy8nKo1Wp07NgRPj4+KCgo4PTs2LEjkpKS4ODggMTERPTp0wdHjx6Fk5MT4uPj8fDhQ5w4cQIhISFV17MmNcpwDxFRXl4erVy5kjp16lQr9ebu7k6TJ0+mrVu3csPBFpBl9zZs2FBvNSoIAi1atIgDeSKi7OxsatiwIYmiSMnJyRyfmEwmysvLo1atWlXp6+jRo1ZqLC8vj/r27UsAaMmSJVxFmUwmUhSFLl++TDqdjjQaDVdrTIXJslwjBr58+TINHTqUevToQXq9nmM/5u6oruTl5dHixYupefPmlJKSYhO/GQwGioqKooULF1JYWBidP3+eKioquMpMSUmhU6dO0bFjx+jQoUN06tQpun//PpWUlNDMmTPpxx9/pNLSUpo3bx7Jskypqak0ZswYAkA6nY4A0N///nciIpo6dSp17dqVwyc2FqZGpZpUEQtb7Ny5EwsXLsTdu3e5RFCpVDalEVNDRUVF+PLLL7F3715MnjwZ0dHRcHNzs+uBb9eunZUkqK2kY572tm3bWoVzTp8+jcLCQnTq1Al9+/aFKIpwcHAAAHh4eODEiROYNWsWLl26BA8PD8yePRvBwcFc+uXm5iIkJAQXLlxATEwM5syZw0NWLPrQpUsXvPTSSzh+/DiOHTsGPz8/yLIMQRDw6NEjxMTE4Pz58xyCAMCjR48QFBSEFStWoEuXLkhMTERJSQmX/JbSyTKKwKRPeXk5vvzyS8TExPD1mD9/Ps6cOcMlGFsDjUYDFxcXPH78GGq1Gg8fPuRS3GQyQa/XQxAEeHp6ok2bNnBycgIAJCUlYf369dDr9diwYQOnaVZWFoYNGwZvb2+sW7cOgiCgtLQUiqKgQYMGUBTFLpSQalJDiqJg9uzZ2LhxIw9hsBAHI151gXGVSoVHjx5h/fr1OHnyJHbt2sVDHgwbsP8DAgLg5eWFBw8e1JrZGFEbNGiAl156yaq/8+fPQxAE9OvXD1qtFj///DNycnI4o+h0OoSFhSE7OxvOzs5o06YNioqK4O7ujszMTPztb3/D1atX8dlnnyEsLKxKbJTNISgoCMePH0d6eroVjZydnTFnzhxMnDgRBw4csBr3hQsXMGzYMPTq1QtExMNTldUg+5uIUFFRgQMHDmDFihW4cuXKHwsoSRAEAefPn8fnn3+O8PBwHr9k9HNxcUFhYSFEUcTvv/9uFZZiqpIVo9HI5yhJEh48eACj0cjr9+jRA4mJiXjxxRfx0UcfITo6muM8s9lcbQhNqileNnHiROzYsYMP3h7X2uuHGRSSJOHq1asIDg5GcnIyOnTowBeLYYVGjRph/PjxHHjXJj4qSRJMJhPeeOMNtGrVykpq3rp1C0SE7t27o6ioCAEBATX216xZM7z66qv48ccfcfPmTXz99dcYNWoUTCYT1Gq1zTYdOnQAANy5c4cT3tIY+vXXX/kCK4oCSZJgNBqxYMECnDx5slaJCEyCTJs2DaWlpdBoNNxYYDT86KOPMHz4cDRt2tSKdh4eHrhz5w50Oh2Kior4xnZ0dOS4jW0StVoNQRDg5OQEs9mMvLw8VFRUcCOkdevWGDNmDPbv3w9fX19ERkYiNze3djHs6gLV0dHR2LFjB3Q6HQeolhLLVsaEKIo8W8AyE8RkMkGr1SI7Oxvjxo2zAuKsHRFh3rx58PHx4SC5NozWuHFjREdHVwkQM8I2bNgQTk5O+OCDDxAaGoqBAwciMDAQ7du3h4eHB1dPgiAgKysLCQkJuHbtGhwdHZGRkWGX6S0tPgAoLi5GeXm5FfMsWrQI169f54aIoigwGo1QqVRITU3FV199ZReOWL5HlmV4eXlxy9oyNYm9Kz8/Hx9++KFNI4HRs6SkBGazGY6OjlZpYaIooqCgAKWlpVi0aBF+/vlnSJKEvLw8lJeXc5rKsgxPT0+MHz8eRqMR3t7emDx5spVUtpfUIdpiNEmSkJqaiqVLl3Jzl+1YxhTMDGf4xNK8Z4zJMhPYQhoMBgDApUuXEBUVZWUeM7XZpEkT7N69Gw0bNuTqoHKOHcNMjGg7duxA69atq+TTWfatVqvx8ccfY8+ePUhKSsL58+dx9epVLFq0yMrcZ31rNBo8evQIBQUFvH11zFD5nZIkIT09HV988QVEUbTSCEzCubq6YvHixcjMzARL9aous0WWZbz77rvo0aNHlSRXhq/379+PrKwsq2ceHh4AALVaDb1ej9LSUisMWFZWhgsXLqBbt274/PPPsWzZMhw7dgyOjo58A1nCGlmW4erqijFjxsDFxcUK9lSXgiXampTBYEBkZCR69+6NsLAwDB06lIM/RVHg4OCAIUOGYNq0aejfv7+V6vD19cWECRMwYcIE+Pr6cmYkIrzwwguYMmUKRo0ahT179iA9Pd1K5TCC9uzZE8nJyQgMDOQMbbmoDC927NgRR48exaBBg6xSblh/zLxnprvBYOC7makzJmErS2hZluHg4ICwsDAIgoAjR45UwaiM+A8fPuTYyNHRkddLTU3leMeS8RlDHz58GOvWreMGRE0Jk4xhPv30Uy71LaUJA/0mk8mqbaNGjTgTGI1GFBQU8DY3b95EQEAAdu3ahczMTFy8eBFubm4oKSmBSqVCWVkZTCYTGjRoYJXjRkTQ6XQYO3Ys2rdvbzf5tFrMJooiLly4gPDwcIwbN47fv3LlCoYOHQpRFHHgwAH4+/vzZ59//jnCwsIwZcoUxMTEwMXFBQBQUlKC2bNnIz4+HrGxsXjnnXf4gFgO2QsvvGC1CxnQ7N69O86cOYO4uDgkJCTgypUrXNJ17NgRb7/9NqZOnQpnZ+cq1i1bNF9fXwiCgBs3bnBCVU5UvHPnDgfGlfHqgAED8Pzzz2P69OlIT09HcHAwlyCWhL1+/ToAoFWrVlZSbMSIEVi+fDkePXrENxV7Pm3aNPTp04dvDtamcv9sEZl0UavV6N27NyZNmoTY2FioVCquRQDg1VdfRcuWLa0woJubG7RaLR9vQUEB2rRpw63LmzdvwtfXF87Ozrh//z5XyYw5v//+e1y4cAFEhNLSUqjVaq6G1Wo1/Pz8agfibfnZiouLrXxgLBxy7NgxOnbsGA+RsHymkpIScnV1pbNnz3LfDmtTWFhI69evt+qP+Y8qKiqqzT2zLCxuGhUVZeV/shUXZH0mJCQQAAoICOB+MUs/GRHx4Pzzzz9PSUlJtGfPHnrvvffIz8+PvvvuOx5Cs0yXqux/HDRoEAGgFStW8PezZyyTRZIkHuds1qwZPX78uNYpSSaTiSIjI63WpaioiFq3bk2CIJAkSeTu7k5jx47lGSxsriy8GB0dTR9++CHNnDmTvvvuO95PamoqiaJIPXr0oObNm5NGoyGNRkOiKPJw2owZM2jHjh00bNgwat68OU2ZMoX7Ai0TK6ZPn04BAQE8tFUrP5urqyuXFpaqadCgQVa4ju26srIyiKKI8vJyjpsYBnF3d8eMGTO4WcxEsNlshk6nq+Jht5RwRASj0QitVotmzZpxa1GlUkGv10Or1dq04Ni9V155Ba6urrh06RLOnTuHfv36cSmgVquxb98+7q5YtmwZBg4cCAAIDQ2Foig4ffo0PvjgA0iShBYtWqC4uJi7Bjw8PCCKIq5evYozZ85ArVbjtddeszojoCgKZsyYgZ07d+Ly5cscZy5ZsgS5ubkoKyvjoSo2f1mW0bRpUyvMum3bNsTHx2Py5MkoKSmBLMtQq9X47LPPkJmZyfGku7s7vLy8rKQagziurq4oKCiAVqvlahQAHBwcQES4ePEiV8NM7bO1GjFiBHr27ImJEyfCbDajadOmvG51WLbWrg9bViZzMNp6ZplWbKuNpWXJXCG2ALYtPx1jOqbuWH92geifqqpFixYICQnBtm3bsHLlSvTr1w9msxlarRa7du3iMIHFc5k6IyJoNBr+TrPZjKVLl2LNmjXcqpw0aRLWr1+PNWvWoKKiAsHBwejSpYvVQjNf3urVqzFkyBCYzWaMHDmS483KvkSVSgWTyYRNmzZh2rRpEASBW5gPHjxAt27drNLEdTod1Go1D6klJCRUwX6WvjbmY8vPz+fPGjduDDc3NxQVFVVxpjP6ZmVlIT09nbun7t27hxs3bqB9+/Z1YjixJuvqSU8v1aeNrT4sgXBtz0sQEebMmQNHR0ccOXIE8fHx0Gq1+PLLLzFu3Dj4+/vDy8sL/v7+8PHx4ZuASRt/f3/069cPLVq0gLe3N5ydneHq6ooGDRqgRYsWSElJwa5duyCKIubPn2+TeWRZxsCBAzFq1CioVCpMnjwZy5Yt40De8jIajVYuJpVKhcWLF+P+/fuQJAllZWUoLy9HeXk5KioqUFRUhIcPHyI3NxfDhg3DqFGj7J5wa9GiBU6ePMmNPBY58PHx4a4be4yampqKzZs3cxwaGRmJjz/+GGfPnoVara7RuV+nQPz/YmEL7e/vj7lz52LJkiX44IMPcOPGDaxatQqBgYE4cuQI9Ho9VCoVNBpNFXXu5eWF06dPo7y8nC+gyWSCk5MT7t69i379+sFkMmHq1Kl45ZVXbIbhGAMuWLAAarUaN2/exN27d3mGiD1NAACHDx+2MgJsQQ0mtVauXGnTmmWaISgoCNu3b8fs2bN5lsvdu3exb98+GAwGmxuYMX1sbCyfy+jRo9GuXTvExMRgwYIFyM/Px/Dhw7lhU51gEZ/GeUf8m78jUZdTV7IsY9GiRRg0aBCys7OxatUqdO3aFefOnYOHhweaNWsGb29vm32zxXN0dIRGo4FGo4GTkxN++eUXDBw4EJmZmQgMDMTq1avtRgAYfuvQoQNiYmKQkZHBGZIxVuWL0fXixYvcn2arHnP2RkVFoWXLljycZk+7tGvXDkuXLoWHhwdmzZqFtWvX4oUXXkB4eHi1rgtmxXfv3h0vv/wyZFmGt7c3Nm3ahOTkZMTFxUEURR57LS4utunKqTezsUjBv+N8Z+UjbZZ/10b9ajQa7Ny5k7saHjx4gH/+859W4t/SSV35suwrISEBQUFByMjIgJ+fH/bt28f9edVtBIZ3evXqxaWUJEl2LwCYNWsWOnfuDJPJxCM27GLhKn9/f0yfPr3Go33MEd+9e3dMmjQJvXv3xvr169G/f38MHjwYDg4OXDrZoqGiKIiKiuJjY/HoTZs2ISMjA5s2bUJmZiYaNWqEhQsXWjnKa51iZM8l8e2339LevXvJZDJRTk4ONWrUiI4fP17nAyDVnQayzJhlGa4s/ZiZ3PZO99gac1FREc+0BUB9+/alvXv3UklJSbXtHz9+TAcPHqTg4GDeduDAgZSVlVXr+bKxGgwGCg0NrTZl6tNPP+Xtjh8/TqIokiiKNuvWleaVacXavfzyyzbPO7ADOTNnzqzS3tLtERMTQ4GBgTZT62uVYlRdNsi2bduQm5uLN998ExqNBo8fP35qJ9ot+9Hr9dDr9fj9998hSRJyc3Px8OFDODg4wNnZuVbSlTlU3dzcsHfvXmzevBmffPIJzpw5gzNnzsDHxwf9+/dH165d4ePjA2dnZ1RUVOD+/fu4dOkSUlJScPv2be6Nnzt3LiIiIjg4rs0YmCpTqVTYvXs3QkND8fPPP1tBEZVKBYPBgJ49e3J8OGDAAEyYMAG7du3CrFmzrJy9ffv2xYABA+p0YNkyI9cyJhsQEICUlBQeiGd1jUYjJk6ciLVr11ZR0wyPMkNs+PDhaN26tf2kgieRbA4ODhQREUGDBw8mHx8fKigoqPWRMnu732Qy0blz5yg8PJy6du1KDRs2tJlM6ezsTF26dKHp06fTuXPnqpyEsjd2Nrbs7GxaunQp+fv78zMM1V3t27enyMhIfqCnPmdG63oul9Hy7t27NGDAAJtt60vrypJt+/btVodq2NWqVSuqqKiwe3Kq8jhsjYdJNiEtLY3Cw8ORnp5u0yKrLr8/JSUFsbGx8PLywty5c/Hcc8/V+5sd7L2FhYX4+OOPkZOTA7VazRP9mA+PAWhZlmEymWA2m+Hp6YmoqCh4eXnZxgp2slqYDy0rKwu//PIL//yCXq+HWq1GkyZN0KFDB3Tu3Bk+Pj485POk3/yo/DGbyskIlv5KRs+bN2+iSZMmcHZ2ruKHfBrnNYgIly5dQnJyMu7fv89TzgcPHsxjzzXR1V6dwMBALFq0CJzZfvjhB5uZojUxR033/lsLs6Zr85EUSyZ9Gn7D+m5E/Ac/7vckG+vFF1/EwoULIVn6R+py4ISZ3Zb5aE9rESz7re1Y6rrDLdOlKn8ayp774t9hfVeXjVwXh/bTovuTzNvyc2OKokB67rnnUFJSgpKSEnh4eNj11dQE5J/m6aj6quEnWczaEPQ/+flXS8PgX1Xs0b0+72RGi16vR0FBAVq2bPnHZ07Hjx+P3Nxc7NmzhyfaPSvPypOW4uJiTJo0CbIs4+DBg398wLmsrAzvvfceLl26hMaNG//Hd/Gzgv8XXwzPz89H27ZtERcXBzc3tz8kG6vALLL/FZD/rPx3G2Dt2rVD165dufD6P8LPlvKXEHeAAAAAAElFTkSuQmCC';

export default function ShipmentDetailPage() {
  useAuth(); // Session check
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [boxes, setBoxes] = useState<ShipmentBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'sent' | 'boxes'>('pending');
  const [showAddItem, setShowAddItem] = useState(false);
  const [addForm, setAddForm] = useState({ iwasku: '', quantity: '', marketplaceId: '' });
  const [allMarketplaces, setAllMarketplaces] = useState<{ id: string; name: string; code: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedSentIds, setSelectedSentIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [unsending, setUnsending] = useState(false);
  const [showExtraBox, setShowExtraBox] = useState(false);
  const [selectedBoxIds, setSelectedBoxIds] = useState<Set<string>>(new Set());
  const [settingDest, setSettingDest] = useState(false);
  const [showBulkFba, setShowBulkFba] = useState(false);
  const [bulkFbaText, setBulkFbaText] = useState('');
  const [bulkFbaResult, setBulkFbaResult] = useState<{ updated: number; notFound?: string[] } | null>(null);

  // Search & filter states
  const [itemSearch, setItemSearch] = useState('');
  const [boxSearch, setBoxSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('');
  const [itemMarketFilter, setItemMarketFilter] = useState('');
  const [boxCategoryFilter, setBoxCategoryFilter] = useState('');
  const [boxDestFilter, setBoxDestFilter] = useState('');
  const [boxMarketFilter, setBoxMarketFilter] = useState('');
  const [sentSearch, setSentSearch] = useState('');
  const [sentCategoryFilter, setSentCategoryFilter] = useState('');
  const [sentMarketFilter, setSentMarketFilter] = useState('');
  // Track printed box IDs (DB'den başlat)
  const printedBoxIds = useMemo(() => new Set(boxes.filter(b => b.labelPrinted).map(b => b.id)), [boxes]);
  // Editable cell tab navigation
  const [editingCell, setEditingCell] = useState<{ boxId: string; field: 'width' | 'depth' | 'height' | 'weight' } | null>(null);

  // Depo çıkış onay modalı
  const [showExitModal, setShowExitModal] = useState(false);
  const [exitItems, setExitItems] = useState<{ iwasku: string; name: string; quantity: number }[]>([]);
  const [exitWeek, setExitWeek] = useState('');
  const [exitSaving, setExitSaving] = useState(false);
  const [exitPage, setExitPage] = useState(0);

  // Permissions from API
  const [perms, setPerms] = useState<Record<string, boolean>>({});

  // FNSKU sync state
  const [syncingFnskuBoxId, setSyncingFnskuBoxId] = useState<string | null>(null);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', plannedDate: '', etaDate: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const fetchShipment = useCallback(async () => {
    try {
      const res = await fetch(`/api/shipments/${id}`);
      const data = await res.json();
      if (data.success) { setShipment(data.data); if (data.permissions) setPerms(data.permissions); }
    } catch { /* */ } finally { setLoading(false); }
  }, [id]);

  const fetchBoxes = useCallback(async () => {
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`);
      const data = await res.json();
      if (data.success) setBoxes(data.data);
    } catch { /* */ }
  }, [id]);

  useEffect(() => { fetchShipment(); fetchBoxes(); }, [fetchShipment, fetchBoxes]);

  // Marketplace listesini çek (ürün ekleme formu için)
  useEffect(() => {
    fetch('/api/marketplaces').then(r => r.json()).then(data => {
      if (data.success) setAllMarketplaces(data.data);
    }).catch(() => {});
  }, []);

  // Marketplace code → name mapping (koliler tablosu icin) — hook, early return'den once olmali
  const mktCodeToName = useMemo(() => {
    const map = new Map<string, string>();
    if (shipment) {
      for (const item of shipment.items) {
        if (item.marketplace?.code && item.marketplace.name) {
          map.set(item.marketplace.code, item.marketplace.name);
        }
      }
    }
    return map;
  }, [shipment]);

  // Filtered items (search + dropdowns) — hook'lar early return'den once olmali
  const filteredPendingItems = useMemo(() => {
    let result = shipment?.items.filter(i => !i.sentAt) ?? [];
    if (itemSearch.trim()) {
      const q = itemSearch.toLowerCase();
      result = result.filter(i =>
        i.iwasku.toLowerCase().includes(q) ||
        (i.fnsku && i.fnsku.toLowerCase().includes(q)) ||
        (i.productName && i.productName.toLowerCase().includes(q))
      );
    }
    if (itemCategoryFilter) result = result.filter(i => i.productCategory === itemCategoryFilter);
    if (itemMarketFilter) result = result.filter(i => i.marketplace?.code === itemMarketFilter);
    return result;
  }, [shipment, itemSearch, itemCategoryFilter, itemMarketFilter]);

  const filteredBoxes = useMemo(() => {
    let result = boxes;
    if (boxSearch.trim()) {
      const q = boxSearch.toLowerCase();
      result = result.filter(b =>
        b.boxNumber.toLowerCase().includes(q) ||
        (b.iwasku && b.iwasku.toLowerCase().includes(q)) ||
        (b.productName && b.productName.toLowerCase().includes(q))
      );
    }
    if (boxCategoryFilter) result = result.filter(b => b.productCategory === boxCategoryFilter);
    if (boxDestFilter) result = result.filter(b => b.destination === boxDestFilter);
    if (boxMarketFilter) result = result.filter(b => b.marketplaceCode === boxMarketFilter);
    return result;
  }, [boxes, boxSearch, boxCategoryFilter, boxDestFilter, boxMarketFilter]);

  // Unique values for dropdown filters
  const itemCategories = useMemo(() => [...new Set((shipment?.items.filter(i => !i.sentAt) ?? []).map(i => i.productCategory).filter(Boolean))].sort(), [shipment]);
  const itemMarkets = useMemo(() => [...new Set((shipment?.items.filter(i => !i.sentAt) ?? []).map(i => i.marketplace?.code).filter(Boolean) as string[])].sort(), [shipment]);
  const boxCategories = useMemo(() => [...new Set(boxes.map(b => b.productCategory).filter(Boolean) as string[])].sort(), [boxes]);
  const boxMarkets = useMemo(() => [...new Set(boxes.map(b => b.marketplaceCode).filter(Boolean) as string[])].sort(), [boxes]);

  const filteredSentItems = useMemo(() => {
    let result = shipment?.items.filter(i => i.sentAt) ?? [];
    if (sentSearch.trim()) {
      const q = sentSearch.toLowerCase();
      result = result.filter(i =>
        i.iwasku.toLowerCase().includes(q) ||
        (i.fnsku && i.fnsku.toLowerCase().includes(q)) ||
        (i.productName && i.productName.toLowerCase().includes(q))
      );
    }
    if (sentCategoryFilter) result = result.filter(i => i.productCategory === sentCategoryFilter);
    if (sentMarketFilter) result = result.filter(i => i.marketplace?.code === sentMarketFilter);
    return result;
  }, [shipment, sentSearch, sentCategoryFilter, sentMarketFilter]);
  const sentCategories = useMemo(() => [...new Set((shipment?.items.filter(i => i.sentAt) ?? []).map(i => i.productCategory).filter(Boolean))].sort(), [shipment]);
  const sentMarkets = useMemo(() => [...new Set((shipment?.items.filter(i => i.sentAt) ?? []).map(i => i.marketplace?.code).filter(Boolean) as string[])].sort(), [shipment]);

  // Donor map: iwasku+quantity → ilk dolu koli (ölçü kopyalama için)
  const donorMap = useMemo(() => {
    const map = new Map<string, ShipmentBox>();
    for (const b of boxes) {
      const key = `${b.iwasku}|${b.quantity}`;
      if (b.width && b.depth && b.height && b.weight && !map.has(key)) {
        map.set(key, b);
      }
    }
    return map;
  }, [boxes]);

  // Izin kontrolu API uzerinden yapiliyor (permissions state)
  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  if (!shipment) return (
    <div className="text-center py-12"><AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" /><p className="text-gray-600">Sevkiyat bulunamadı</p>
      <Link href="/dashboard/shipments" className="text-blue-600 text-sm mt-2 inline-block">Geri dön</Link></div>
  );

  const MethodIcon = methodIcons[shipment.shippingMethod] ?? Anchor;
  const isActive = shipment.status === 'PLANNING' || shipment.status === 'LOADING';
  const isSea = BOX_ENTRY_METHODS.has(shipment.shippingMethod);

  // Permission shortcuts
  const canRoute = perms.routeItems ?? false;
  const canDelete = perms.deleteItems ?? false;
  const canBoxes = perms.manageBoxes ?? false;
  const canPack = perms.packItems ?? false;
  const canSend = perms.sendItems ?? false;
  const canClose = perms.closeShipment ?? false;
  const canUnsend = perms.unsendItems ?? false;
  const canDest = perms.setDestination ?? false;
  const canEdit = perms.createShipment ?? false; // manager = edit shipment info
  const pendingItems = shipment.items.filter(i => !i.sentAt);
  const sentItems = shipment.items.filter(i => i.sentAt);
  const totalQty = shipment.items.reduce((s, i) => s + i.quantity, 0);
  const totalItemDesi = shipment.items.reduce((s, i) => s + (i.desi ?? 0) * i.quantity, 0);
  const totalBoxDesi = boxes.reduce((s, b) => {
    const d = (b.width && b.depth && b.height) ? (b.width * b.depth * b.height / 5000) : 0;
    return s + d;
  }, 0);
  const packedPendingCount = pendingItems.filter(i => i.packed).length;
  const plannedDate = shipment.plannedDate
    ? new Date(shipment.plannedDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const startEdit = () => {
    setEditForm({
      name: shipment.name,
      plannedDate: shipment.plannedDate ? new Date(shipment.plannedDate).toISOString().split('T')[0] : '',
      etaDate: shipment.etaDate ? new Date(shipment.etaDate).toISOString().split('T')[0] : '',
      notes: shipment.notes ?? '',
    });
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/shipments/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: editForm.notes || undefined,
          ...(editForm.plannedDate ? { plannedDate: new Date(editForm.plannedDate).toISOString() } : {}),
          ...(editForm.etaDate ? { etaDate: new Date(editForm.etaDate).toISOString() } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) { setEditing(false); await fetchShipment(); }
      else alert(data.error);
    } catch { alert('Kaydetme hatası'); } finally { setSaving(false); }
  };

  // --- Handlers ---
  const handleTogglePacked = async (itemId: string) => {
    setTogglingId(itemId);
    try {
      const res = await fetch(`/api/shipments/${id}/items/${itemId}`, { method: 'PATCH' });
      const data = await res.json();
      if (data.success) setShipment(prev => prev ? { ...prev, items: prev.items.map(i => i.id === itemId ? { ...i, packed: data.data.packed } : i) } : prev);
    } catch { /* */ } finally { setTogglingId(null); }
  };

  const handleToggleSelect = (itemId: string) => {
    const next = new Set(selectedIds);
    next.has(itemId) ? next.delete(itemId) : next.add(itemId);
    setSelectedIds(next);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Bu ürün sevkiyattan çıkarılsın mı?')) return;
    const res = await fetch(`/api/shipments/${id}/items/${itemId}`, { method: 'DELETE' });
    if ((await res.json()).success) await Promise.all([fetchShipment(), fetchBoxes()]);
  };

  const handleSelectAllPacked = () => {
    const packedPendingIds = pendingItems.filter(i => i.packed).map(i => i.id);
    if (packedPendingIds.every(id => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(packedPendingIds));
    }
  };

  // Pazartesi hesapla (bugünün haftası)
  const getMonday = (d: Date) => {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d);
    mon.setDate(diff);
    return mon.toISOString().split('T')[0];
  };

  // Depo çıkış modalını aç (gönderilen item'lar ile)
  const openExitModal = (sentItems: { iwasku: string; productName: string; quantity: number }[]) => {
    // IWASKU bazlı grupla
    const grouped = new Map<string, { iwasku: string; name: string; quantity: number }>();
    for (const item of sentItems) {
      const existing = grouped.get(item.iwasku);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        grouped.set(item.iwasku, { iwasku: item.iwasku, name: item.productName || item.iwasku, quantity: item.quantity });
      }
    }
    setExitItems([...grouped.values()]);
    setExitWeek(getMonday(new Date()));
    setExitPage(0);
    setShowExitModal(true);
  };

  // Depo çıkış onayı
  const handleConfirmExit = async () => {
    setExitSaving(true);
    try {
      const res = await fetch(`/api/shipments/${id}/warehouse-exit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: exitItems.map(i => ({ iwasku: i.iwasku, quantity: i.quantity })),
          weekStart: exitWeek,
        }),
      });
      const data = await res.json();
      if (data.success) setShowExitModal(false);
      else alert(data.error);
    } catch { alert('Çıkış kayıt hatası'); } finally { setExitSaving(false); }
  };

  // Karayolu/hava: seçili packed itemleri gönder
  const handleSendSelected = async () => {
    const toSend = [...selectedIds].filter(sid => {
      const item = pendingItems.find(i => i.id === sid);
      return item?.packed;
    });
    if (toSend.length === 0) return;
    if (!confirm(`${toSend.length} ürün gönderilsin mi?`)) return;
    setSending(true);
    try {
      const res = await fetch(`/api/shipments/${id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: toSend }),
      });
      const data = await res.json();
      if (data.success) {
        // Gönderilen item'ları al ve modal aç
        const sentItemDetails = toSend.map(sid => pendingItems.find(i => i.id === sid)!).filter(Boolean);
        setSelectedIds(new Set());
        await fetchShipment();
        openExitModal(sentItemDetails);
      } else alert(data.error);
    } catch { alert('Gönderim hatası'); } finally { setSending(false); }
  };

  // Gönderilmişleri geri al
  const handleUnsendSelected = async () => {
    const toUnsend = [...selectedSentIds];
    if (toUnsend.length === 0) return;
    if (!confirm(`${toUnsend.length} ürünün gönderimi geri alınsın mı?`)) return;
    setUnsending(true);
    try {
      const res = await fetch(`/api/shipments/${id}/unsend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: toUnsend }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedSentIds(new Set());
        await fetchShipment();
      } else alert(data.error);
    } catch { alert('Geri alma hatası'); } finally { setUnsending(false); }
  };

  // Gönderilenleri depo çıkışı modalına gönder
  const handleExitForSent = () => {
    const items = [...selectedSentIds].map(sid => sentItems.find(i => i.id === sid)!).filter(Boolean);
    if (items.length === 0) return;
    openExitModal(items);
    setSelectedSentIds(new Set());
  };

  // Deniz: sevkiyatı kapat
  const handleCloseShipment = async () => {
    if (!confirm('Sevkiyat kapatılsın mı? Tüm ürünler gönderilmiş olarak işaretlenecek.')) return;
    setSending(true);
    try {
      const res = await fetch(`/api/shipments/${id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closeShipment: true }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchShipment();
        // Koli toplamlarından depo çıkış modalını aç (talep değil, gerçek koli miktarları)
        const boxRes = await fetch(`/api/shipments/${id}/boxes`);
        const boxData = await boxRes.json();
        if (boxData.success && boxData.data.length > 0) {
          const boxItems = (boxData.data as ShipmentBox[])
            .filter(b => b.iwasku)
            .map(b => ({ iwasku: b.iwasku!, productName: b.productName || b.iwasku!, quantity: b.quantity }));
          openExitModal(boxItems);
        }
      } else alert(data.error);
    } catch { alert('Kapama hatası'); } finally { setSending(false); }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault(); setAdding(true);
    try {
      const res = await fetch(`/api/shipments/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ iwasku: addForm.iwasku, quantity: parseInt(addForm.quantity), marketplaceId: addForm.marketplaceId || undefined }] }),
      });
      const data = await res.json();
      if (data.success) { setAddForm({ iwasku: '', quantity: '', marketplaceId: '' }); setShowAddItem(false); fetchShipment(); }
      else alert(data.error);
    } catch { alert('Hata'); } finally { setAdding(false); }
  };

  const handleCreateBox = async (form: BoxFormData, shipmentItemId: string | null) => {
    const res = await fetch(`/api/shipments/${id}/boxes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, shipmentItemId }),
    });
    const data = await res.json();
    if (data.success) { await Promise.all([fetchBoxes(), fetchShipment()]); return data.data as ShipmentBox; }
    else { alert(data.error); return null; }
  };

  const handleSyncFnsku = async (boxId: string) => {
    setSyncingFnskuBoxId(boxId);
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId, syncFnsku: true }),
      });
      const data = await res.json();
      if (data.success) {
        setBoxes(prev => prev.map(b => b.id === boxId ? { ...b, fnsku: data.data.fnsku } : b));
      }
    } finally {
      setSyncingFnskuBoxId(null);
    }
  };

  const handleDeleteBox = async (boxId: string) => {
    if (!confirm('Bu koli silinsin mi?')) return;
    const res = await fetch(`/api/shipments/${id}/boxes?boxId=${boxId}`, { method: 'DELETE' });
    if ((await res.json()).success) await Promise.all([fetchBoxes(), fetchShipment()]);
  };

  const handleSetDestination = async (destination: 'FBA' | 'DEPO') => {
    const ids = [...selectedBoxIds];
    if (ids.length === 0) return;
    setSettingDest(true);
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxIds: ids, destination }),
      });
      const data = await res.json();
      if (data.success) {
        setBoxes(prev => prev.map(b => ids.includes(b.id) ? { ...b, destination } : b));
        setSelectedBoxIds(new Set());
      }
    } catch { /* */ } finally { setSettingDest(false); }
  };

  const handleBulkFbaSubmit = async (dest: 'FBA' | 'DEPO') => {
    const numbers = bulkFbaText.split(/[\n,;\t]+/).map(s => s.trim()).filter(Boolean);
    if (numbers.length === 0) return;
    setSettingDest(true); setBulkFbaResult(null);
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxNumbers: numbers, destination: dest }),
      });
      const data = await res.json();
      if (data.success) {
        setBulkFbaResult(data.data);
        await fetchBoxes();
        if (data.data.updated > 0) setBulkFbaText('');
      }
    } catch { /* */ } finally { setSettingDest(false); }
  };

  const handleToggleBoxSelect = (boxId: string) => {
    const next = new Set(selectedBoxIds);
    next.has(boxId) ? next.delete(boxId) : next.add(boxId);
    setSelectedBoxIds(next);
  };

  const handleSelectAllBoxes = () => {
    if (selectedBoxIds.size === boxes.length) setSelectedBoxIds(new Set());
    else setSelectedBoxIds(new Set(boxes.map(b => b.id)));
  };

  const handleExportBoxes = async () => {
    const XLSX = await loadXLSX();
    const rows = boxes.map((b, i) => {
      const desi = (b.width && b.depth && b.height) ? (b.width * b.depth * b.height / 5000) : null;
      return { '#': i + 1, 'Koli No': b.boxNumber, 'IWASKU': b.iwasku ?? '', 'FNSKU': b.fnsku ?? '', 'Ürün Adı': b.productName ?? '', 'Kategori': b.productCategory ?? '', 'Pazar Yeri': b.marketplaceCode ?? '', 'Hedef': b.destination, 'Adet': b.quantity, 'En': b.width ?? '', 'Boy': b.depth ?? '', 'Yuk.': b.height ?? '', 'Ağr.': b.weight ?? '', 'Desi': desi ? +desi.toFixed(1) : '' };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 4 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 40 }, { wch: 20 }, { wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Koliler');
    XLSX.writeFile(wb, `${shipment.name}-koliler-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportShipmate = async () => {
    const usBoxes = boxes.filter(b => b.marketplaceCode === 'AMZN_US' && b.fnsku);
    if (usBoxes.length === 0) return alert('Amazon US pazar yerine ait FNSKU\'lu koli bulunamadı.');
    const XLSX = await loadXLSX();
    const rows = usBoxes.map(b => ({
      koli_no: b.boxNumber,
      name: b.productName ?? '',
      fnsku: b.fnsku ?? '',
      quantity: b.quantity,
      weight: b.weight ?? '',
      length: b.depth ?? '',
      width: b.width ?? '',
      height: b.height ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 50 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Shipmate');
    XLSX.writeFile(wb, `${shipment.name}-shipmate-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handlePrintBoxLabel = async (box: ShipmentBox) => {
    const [JsBarcode, { jsPDF }] = await Promise.all([
      import('jsbarcode').then(m => m.default),
      import('jspdf'),
    ]);

    const PX_PER_MM = 8;
    const W_MM = 60, H_MM = 40;
    const CW = W_MM * PX_PER_MM, CH = H_MM * PX_PER_MM;

    const renderCanvasLabel = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = CW; c.height = CH;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = '#000';
      draw(ctx);
      return c.toDataURL('image/png');
    };

    const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    const name = box.productName || '';
    const marketplace = box.marketplaceCode || '';
    const code = box.fnsku || box.iwasku;
    const doc = new jsPDF({ unit: 'mm', format: [W_MM, H_MM], orientation: 'landscape' });

    // 5 adet koli no etiketi
    for (let i = 0; i < 5; i++) {
      if (i > 0) doc.addPage([W_MM, H_MM], 'landscape');

      const boxLabelImg = renderCanvasLabel((ctx) => {
        ctx.font = 'bold 100px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(box.boxNumber, CW / 2, 115);

        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(24, 135);
        ctx.lineTo(CW - 24, 135);
        ctx.stroke();

        ctx.font = 'bold 36px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${box.quantity} adet`, CW / 2, 175);

        ctx.font = '30px Arial';
        const nameLines = wrapText(ctx, name, CW - 60);
        let y = 210;
        for (const ln of nameLines.slice(0, 3)) {
          ctx.fillText(ln, CW / 2, y);
          y += 36;
        }

        ctx.font = '22px Arial';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.fillText(marketplace, CW - 24, CH - 16);
      });
      doc.addImage(boxLabelImg, 'PNG', 0, 0, W_MM, H_MM);
    }

    // Barkod etiketleri (quantity kadar, birer adet)
    if (code) {
      const label = box.fnsku ? 'FNSKU' : 'IWASKU';
      const isEU = /^AMZN_(UK|EU|DE|FR|IT|ES|NL|SE|PL|BE)$/.test(marketplace);
      const sn = (name.split(' ')[0]) || '';
      const bcCanvas = document.createElement('canvas');
      JsBarcode(bcCanvas, code, { format: 'CODE128', width: 2, height: 50, displayValue: false, margin: 0 });

      for (let i = 0; i < box.quantity; i++) {
        doc.addPage([W_MM, H_MM], 'landscape');

        const barcodeImg = renderCanvasLabel((ctx) => {
          if (isEU) {
            // === EU/UK: FNSKU barcode + GPSR bilgisi ===
            const bw = 420, bh = 120; // barcode min 1.5cm = 120px
            ctx.drawImage(bcCanvas, (CW - bw) / 2, 6, bw, bh);

            ctx.font = 'bold 22px Courier New';
            ctx.textAlign = 'center';
            ctx.fillText(`${code}  (${label})`, CW / 2, 146);

            ctx.font = '15px Arial';
            const prodLine = wrapText(ctx, name, CW - 30);
            ctx.fillText(prodLine[0] || '', CW / 2, 166);

            // Ayırıcı çizgi
            ctx.strokeStyle = '#999';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(12, 174);
            ctx.lineTo(CW - 12, 174);
            ctx.stroke();

            // GPSR bilgileri — sol: logo + semboller, sağ: metin
            ctx.fillStyle = '#000';

            // Sol: Logo (desen) + EURP ikonu + semboller
            const logoImg = new Image();
            logoImg.src = GPSR_LOGO_B64;
            ctx.drawImage(logoImg, 12, 178, 48, 26);
            const eurpImg = new Image();
            eurpImg.src = GPSR_EURP_B64;
            ctx.drawImage(eurpImg, 12, 206, 18, 28);
            const symImg = new Image();
            symImg.src = GPSR_SYMBOLS_B64;
            ctx.drawImage(symImg, 12, 240, 90, 18);

            // Sağ: metin bilgileri
            ctx.textAlign = 'left';
            const gx = 68;

            ctx.font = 'bold 14px Arial';
            ctx.fillText('IWA Concept Ltd.Sti.', gx, 190);

            ctx.font = '12px Arial';
            ctx.fillText('Ankara/TR · iwaconcept.com', gx, 204);

            ctx.font = '12px Arial';
            ctx.fillText('RP: Emre Bedel', gx, 218);
            ctx.fillText('responsible@iwaconcept.com', gx, 230);

            ctx.font = 'bold 13px Courier New';
            ctx.fillText(`PN: ${box.iwasku || code}`, gx, 246);
            if (sn) ctx.fillText(`SN: ${sn}`, gx + 200, 246);

            // Alt satır: koli no + marketplace
            ctx.font = '16px Courier New';
            ctx.fillStyle = '#666';
            ctx.textAlign = 'left';
            ctx.fillText(box.boxNumber, 16, CH - 8);
            ctx.textAlign = 'right';
            ctx.fillText(marketplace, CW - 16, CH - 8);
          } else {
            // === US/CA/AU: Mevcut layout (GPSR yok) ===
            const bw = 430, bh = 140;
            ctx.drawImage(bcCanvas, (CW - bw) / 2, 10, bw, bh);

            ctx.font = 'bold 28px Courier New';
            ctx.textAlign = 'center';
            ctx.fillText(`${code}  (${label})`, CW / 2, 178);

            ctx.font = '18px Arial';
            const lines = wrapText(ctx, name, CW - 40);
            let y = 204;
            for (const ln of lines.slice(0, 2)) {
              ctx.fillText(ln, CW / 2, y);
              y += 22;
            }

            ctx.font = '18px Courier New';
            ctx.fillStyle = '#888';
            ctx.textAlign = 'left';
            ctx.fillText(box.boxNumber, 16, CH - 10);
            ctx.textAlign = 'right';
            ctx.fillText(marketplace, CW - 16, CH - 10);
          }
        });
        doc.addImage(barcodeImg, 'PNG', 0, 0, W_MM, H_MM);
      }
    }

    doc.save(`${box.boxNumber}.pdf`);
    // DB'de labelPrinted işaretle
    try {
      await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId: box.id, labelPrinted: true }),
      });
      fetchBoxes();
    } catch { /* */ }
  };

  // Karayolu/hava: ürün satırından GPSR'lı FNSKU etiket bas
  const handlePrintItemLabel = async (item: ShipmentItem, labelCount: number) => {
    const code = item.fnsku || item.iwasku;
    if (!code || labelCount < 1) return;

    const [JsBarcode, { jsPDF }] = await Promise.all([
      import('jsbarcode').then(m => m.default),
      import('jspdf'),
    ]);

    const PX_PER_MM = 8;
    const W_MM = 60, H_MM = 40;
    const CW = W_MM * PX_PER_MM, CH = H_MM * PX_PER_MM;

    const renderCanvas = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = CW; c.height = CH;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = '#000';
      draw(ctx);
      return c.toDataURL('image/png');
    };

    const wrapLine = (ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let line = '';
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else { line = test; }
      }
      if (line) lines.push(line);
      return lines;
    };

    const label = item.fnsku ? 'FNSKU' : 'IWASKU';
    const marketplace = item.marketplace?.code || '';
    const itemName = item.productName || '';
    const sn = itemName.split(' ')[0] || '';
    const isEU = /^AMZN_(UK|EU|DE|FR|IT|ES|NL|SE|PL|BE)$/.test(marketplace);

    const bcCanvas = document.createElement('canvas');
    JsBarcode(bcCanvas, code, { format: 'CODE128', width: 2, height: 50, displayValue: false, margin: 0 });

    const doc = new jsPDF({ unit: 'mm', format: [W_MM, H_MM], orientation: 'landscape' });

    for (let i = 0; i < labelCount; i++) {
      if (i > 0) doc.addPage([W_MM, H_MM], 'landscape');

      const img = renderCanvas((ctx) => {
        if (isEU) {
          const bw = 420, bh = 120;
          ctx.drawImage(bcCanvas, (CW - bw) / 2, 6, bw, bh);
          ctx.font = 'bold 22px Courier New';
          ctx.textAlign = 'center';
          ctx.fillText(`${code}  (${label})`, CW / 2, 146);
          ctx.font = '15px Arial';
          const prodLine = wrapLine(ctx, itemName, CW - 30);
          ctx.fillText(prodLine[0] || '', CW / 2, 166);
          ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(12, 174); ctx.lineTo(CW - 12, 174); ctx.stroke();
          ctx.fillStyle = '#000';
          // Sol: Logo + EURP + semboller
          const li = new Image(); li.src = GPSR_LOGO_B64;
          ctx.drawImage(li, 12, 178, 48, 26);
          const ei = new Image(); ei.src = GPSR_EURP_B64;
          ctx.drawImage(ei, 12, 206, 18, 28);
          const si = new Image(); si.src = GPSR_SYMBOLS_B64;
          ctx.drawImage(si, 12, 240, 90, 18);
          // Sağ: metin
          ctx.textAlign = 'left';
          const gx = 68;
          ctx.font = 'bold 14px Arial';
          ctx.fillText('IWA Concept Ltd.Sti.', gx, 190);
          ctx.font = '12px Arial';
          ctx.fillText('Ankara/TR · iwaconcept.com', gx, 204);
          ctx.fillText('RP: Emre Bedel', gx, 218);
          ctx.fillText('responsible@iwaconcept.com', gx, 230);
          ctx.font = 'bold 13px Courier New';
          ctx.fillText(`PN: ${item.iwasku || code}`, gx, 246);
          if (sn) ctx.fillText(`SN: ${sn}`, gx + 200, 246);
          ctx.font = '16px Courier New'; ctx.fillStyle = '#666';
          ctx.textAlign = 'right';
          ctx.fillText(marketplace, CW - 16, CH - 8);
        } else {
          const bw = 430, bh = 140;
          ctx.drawImage(bcCanvas, (CW - bw) / 2, 10, bw, bh);
          ctx.font = 'bold 28px Courier New';
          ctx.textAlign = 'center';
          ctx.fillText(`${code}  (${label})`, CW / 2, 178);
          ctx.font = '18px Arial';
          const lines = wrapLine(ctx, itemName, CW - 40);
          let y = 204;
          for (const ln of lines.slice(0, 2)) { ctx.fillText(ln, CW / 2, y); y += 22; }
          ctx.font = '18px Courier New'; ctx.fillStyle = '#888';
          ctx.textAlign = 'right';
          ctx.fillText(marketplace, CW - 16, CH - 10);
        }
      });
      doc.addImage(img, 'PNG', 0, 0, W_MM, H_MM);
    }

    doc.save(`${item.iwasku}-${label}-x${labelCount}.pdf`);
  };

  // Ölçü kopyalama: aynı iwasku+quantity olan dolu koliden kopyala
  const handleCopyDimensions = async (targetBox: ShipmentBox, donorBox: ShipmentBox) => {
    const updates = { boxId: targetBox.id, width: donorBox.width, depth: donorBox.depth, height: donorBox.height, weight: donorBox.weight };
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if ((await res.json()).success) fetchBoxes();
    } catch { /* */ }
  };

  const handleExportItems = async () => {
    const XLSX = await loadXLSX();
    const rows = shipment.items.map((item, i) => ({ '#': i + 1, 'IWASKU': item.iwasku, 'FNSKU': item.fnsku ?? '', 'Ürün Adı': item.productName, 'Kategori': item.productCategory, 'Pazar Yeri': item.marketplace?.code ?? '', 'Miktar': item.quantity, 'Desi': item.desi ? Math.round(item.desi * item.quantity) : '', 'Durum': item.sentAt ? 'Gönderildi' : item.packed ? 'Hazır' : 'Bekliyor' }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Ürünler');
    XLSX.writeFile(wb, `${shipment.name}-urunler-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Selected packed items count
  const selectedPackedCount = [...selectedIds].filter(sid => pendingItems.find(i => i.id === sid)?.packed).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard/shipments')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5 text-gray-500" /></button>
          <MethodIcon className="w-6 h-6 text-blue-500" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{shipment.name}</h1>
              {isActive && canEdit && !editing && (
                <button onClick={startEdit} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" title="Düzenle">
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{shipment.destinationTab}</span><span>·</span>
              <span>{methodLabels[shipment.shippingMethod]}</span>
              {plannedDate && <><span>·</span><span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{plannedDate}</span></>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {isActive && isSea && canClose && pendingItems.length > 0 && (
            <button onClick={handleCloseShipment} disabled={sending}
              className="px-3 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ship className="w-4 h-4" />} Sevkiyatı Kapat
            </button>
          )}
          {!isActive && shipment.status === 'IN_TRANSIT' && (
            <button onClick={async () => {
              if (!confirm('Teslim edildi?')) return;
              const res = await fetch(`/api/shipments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DELIVERED' }) });
              if ((await res.json()).success) fetchShipment();
            }} className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-2">Teslim Edildi</button>
          )}
        </div>
      </div>

      {/* Edit Panel */}
      {editing && (
        <div className="bg-white border border-blue-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">Sevkiyat Bilgilerini Düzenle</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İsim</label>
              <input type="text" value={editForm.name} disabled className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Planlanan Tarih</label>
              <input type="date" value={editForm.plannedDate} onChange={e => setEditForm(f => ({ ...f, plannedDate: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tahmini Varış (ETA)</label>
              <input type="date" value={editForm.etaDate} onChange={e => setEditForm(f => ({ ...f, etaDate: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Not</label>
              <input type="text" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Sevkiyat notu..." />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleSaveEdit} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Kaydet
            </button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">İptal</button>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{shipment.items.length}</p><p className="text-xs text-gray-500">Toplam Ürün</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalQty.toLocaleString('tr-TR')}</p><p className="text-xs text-gray-500">Toplam Ünite</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{Math.round(totalItemDesi).toLocaleString('tr-TR')}</p>
          <p className="text-xs text-gray-500">Ürün Desi</p>
          {isSea && totalBoxDesi > 0 && (
            <p className="text-xs text-blue-600 mt-1">{Math.round(totalBoxDesi).toLocaleString('tr-TR')} koli desi</p>
          )}
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{pendingItems.length}</p><p className="text-xs text-gray-500">Bekleyen</p>
          {sentItems.length > 0 && <p className="text-xs text-green-600 mt-1">{sentItems.length} gönderildi</p>}
        </div>
      </div>

      {/* FNSKU Eksik Uyarisi */}
      {(() => {
        const missingFnsku = pendingItems.filter(i => !i.fnsku && i.marketplace?.code?.startsWith('AMZN'));
        if (missingFnsku.length === 0) return null;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">{missingFnsku.length} üründe FNSKU eksik</p>
                <p className="text-xs text-amber-600 mt-1">Tabloda &quot;Eksik&quot; yazan hücreye tıklayarak FNSKU girebilirsiniz.</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {missingFnsku.map(i => (
                    <span key={i.id} className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-xs font-mono">{i.iwasku}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b">
        <button onClick={() => setActiveTab('pending')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'pending' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          {isSea ? `Ürünler (${pendingItems.length})` : `Bekleyen (${pendingItems.length})`}
        </button>
        {!isSea && (
          <button onClick={() => setActiveTab('sent')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'sent' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            Gönderilenler ({sentItems.length})
          </button>
        )}
        {isSea && (
          <button onClick={() => setActiveTab('boxes')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'boxes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            Koliler ({boxes.length})
          </button>
        )}
      </div>

      {/* === PENDING TAB === */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            {isActive && canRoute && (
              <button onClick={() => setShowAddItem(!showAddItem)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                <Plus className="w-4 h-4" /> Ürün Ekle
              </button>
            )}
            <button onClick={handleExportItems} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 border">
              <Download className="w-4 h-4" /> Excel
            </button>
            {pendingItems.length > 0 && (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                    placeholder="SKU, ürün adı..."
                    className="pl-9 pr-3 py-2 border rounded-lg text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  {itemSearch && (
                    <button onClick={() => setItemSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {itemCategories.length > 1 && (
                  <select value={itemCategoryFilter} onChange={e => setItemCategoryFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                    <option value="">Tüm Kategoriler</option>
                    {itemCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {itemMarkets.length > 1 && (
                  <select value={itemMarketFilter} onChange={e => setItemMarketFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                    <option value="">Tüm Pazarlar</option>
                    {itemMarkets.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </>
            )}
            {/* Karayolu/hava: Gönder butonu */}
            {!isSea && canSend && selectedPackedCount > 0 && (
              <button onClick={handleSendSelected} disabled={sending}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {selectedPackedCount} ürün gönder
              </button>
            )}
          </div>

          {showAddItem && (
            <form onSubmit={handleAddItem} className="bg-white border border-blue-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
              <div><label className="block text-xs font-medium text-gray-600 mb-1">IWASKU</label>
                <input type="text" required value={addForm.iwasku} onChange={e => setAddForm(f => ({ ...f, iwasku: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm w-48" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Miktar</label>
                <input type="number" required value={addForm.quantity} onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm w-24" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Pazaryeri</label>
                <select required value={addForm.marketplaceId} onChange={e => setAddForm(f => ({ ...f, marketplaceId: e.target.value }))}
                  className="px-3 py-2 border rounded-lg text-sm w-48">
                  <option value="">Seçiniz</option>
                  {allMarketplaces.map(mp => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
                </select></div>
              <button type="submit" disabled={adding} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {adding && <Loader2 className="w-4 h-4 animate-spin" />} Ekle</button>
            </form>
          )}

          {/* Pending items table */}
          <div className="bg-white border rounded-xl overflow-hidden">
            {pendingItems.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="w-12 px-3 py-3">
                      {isActive && !isSea && canSend && packedPendingCount > 0 && (
                        <button onClick={handleSelectAllPacked} className="text-gray-600 hover:text-purple-600" title="Hazırları seç">
                          {packedPendingCount > 0 && [...selectedIds].length >= packedPendingCount ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                        </button>
                      )}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Ürün Adı</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Kategori</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">T. Desi</th>
                    {isActive && <th className="w-10"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredPendingItems.map(item => {
                    const itemDesi = (item.desi ?? 0) * item.quantity;
                    const isExpanded = expandedItemId === item.id;
                    const itemBoxes = boxes.filter(b => b.shipmentItemId === item.id);
                    return (
                      <PendingItemRow key={item.id} item={item} itemDesi={itemDesi} itemBoxes={itemBoxes}
                        isSea={isSea} isActive={isActive} isExpanded={isExpanded}
                        isSelected={selectedIds.has(item.id)} togglingId={togglingId}
                        canBoxes={canBoxes} canPack={canPack} canSend={canSend} canDelete={canDelete}
                        onTogglePacked={() => handleTogglePacked(item.id)}
                        onToggleSelect={() => handleToggleSelect(item.id)}
                        onToggleExpand={() => setExpandedItemId(isExpanded ? null : item.id)}
                        onCreateBox={(form) => handleCreateBox(form, item.id)}
                        onDeleteBox={handleDeleteBox}
                        onDeleteItem={() => handleDeleteItem(item.id)}
                        onFnskuSaved={(itemId, fnsku) => {
                          setShipment(prev => prev ? {
                            ...prev,
                            items: prev.items.map(i => i.id === itemId ? { ...i, fnsku } : i),
                          } : prev);
                        }}
                        onPrintLabel={handlePrintItemLabel} />
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-12"><Check className="w-10 h-10 text-green-300 mx-auto mb-3" /><p className="text-gray-500">Bekleyen ürün yok</p></div>
            )}
          </div>
        </div>
      )}

      {/* === SENT TAB === */}
      {activeTab === 'sent' && (
        <div className="space-y-4">
          {/* Sent tab search/filter + action buttons */}
          {sentItems.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" value={sentSearch} onChange={e => setSentSearch(e.target.value)}
                  placeholder="SKU, ürün adı..."
                  className="pl-9 pr-3 py-2 border rounded-lg text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                {sentSearch && (
                  <button onClick={() => setSentSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {sentCategories.length > 1 && (
                <select value={sentCategoryFilter} onChange={e => setSentCategoryFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                  <option value="">Tüm Kategoriler</option>
                  {sentCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {sentMarkets.length > 1 && (
                <select value={sentMarketFilter} onChange={e => setSentMarketFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                  <option value="">Tüm Pazarlar</option>
                  {sentMarkets.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              {canSend && selectedSentIds.size > 0 && (
                <button onClick={handleExitForSent}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
                  <Package className="w-4 h-4" />
                  {selectedSentIds.size} ürün — Depo Çıkışı Kaydet
                </button>
              )}
              {canUnsend && selectedSentIds.size > 0 && (
                <button onClick={handleUnsendSelected} disabled={unsending}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50">
                  {unsending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  {selectedSentIds.size} ürün — Gönderimi Geri Al
                </button>
              )}
            </div>
          )}
          <div className="bg-white border rounded-xl overflow-hidden">
            {sentItems.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {(canSend || canUnsend) && (
                      <th className="w-12 px-3 py-3">
                        <button onClick={() => {
                          if (selectedSentIds.size === sentItems.length) setSelectedSentIds(new Set());
                          else setSelectedSentIds(new Set(sentItems.map(i => i.id)));
                        }} className="text-gray-600 hover:text-purple-600" title="Tümünü seç">
                          {selectedSentIds.size === sentItems.length && sentItems.length > 0 ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                        </button>
                      </th>
                    )}
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Ürün Adı</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Kategori</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Gönderim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSentItems.map(item => (
                    <tr key={item.id} className={`${selectedSentIds.has(item.id) ? 'bg-blue-50/50' : 'bg-green-50/30'}`}>
                      {(canSend || canUnsend) && (
                        <td className="px-3 py-3">
                          <button onClick={() => {
                            const next = new Set(selectedSentIds);
                            next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                            setSelectedSentIds(next);
                          }} className="text-gray-500 hover:text-purple-600">
                            {selectedSentIds.has(item.id) ? <CheckSquare className="w-5 h-5 text-purple-600" /> : <Square className="w-5 h-5" />}
                          </button>
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-sm text-gray-900">{item.iwasku}</td>
                      <td className="px-3 py-3 font-mono text-sm text-gray-600">{item.fnsku || '—'}</td>
                      <td className="px-3 py-3 text-xs text-gray-700 line-clamp-1">{item.productName || '—'}</td>
                      <td className="px-3 py-3 text-sm text-gray-600">{item.productCategory || '—'}</td>
                      <td className="px-3 py-3 text-sm text-gray-600">{item.marketplace?.name ?? '—'}</td>
                      <td className="text-center px-3 py-3 font-semibold text-gray-900">{item.quantity}</td>
                      <td className="text-center px-3 py-3 text-xs text-green-700">
                        {item.sentAt ? new Date(item.sentAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-12"><Ship className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">Henüz gönderilen ürün yok</p></div>
            )}
          </div>
        </div>
      )}

      {/* === BOXES TAB === */}
      {activeTab === 'boxes' && isSea && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            {isActive && canBoxes && (
              <button onClick={() => setShowExtraBox(!showExtraBox)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                <Plus className="w-4 h-4" /> Ek Koli
              </button>
            )}
            {canDest && boxes.length > 0 && (
              <button onClick={() => setShowBulkFba(!showBulkFba)} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600">
                Toplu FBA İşaretle
              </button>
            )}
            {boxes.length > 0 && (
              <button onClick={handleExportBoxes} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 border">
                <Download className="w-4 h-4" /> Excel Koli Listesi
              </button>
            )}
            {canEdit && boxes.length > 0 && (
              <button onClick={handleExportShipmate} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
                <Download className="w-4 h-4" /> Shipmate İndir
              </button>
            )}
            {boxes.length > 0 && (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" value={boxSearch} onChange={e => setBoxSearch(e.target.value)}
                    placeholder="Koli no, SKU, ürün..."
                    className="pl-9 pr-3 py-2 border rounded-lg text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  {boxSearch && (
                    <button onClick={() => setBoxSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {boxCategories.length > 1 && (
                  <select value={boxCategoryFilter} onChange={e => setBoxCategoryFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                    <option value="">Tüm Kategoriler</option>
                    {boxCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <select value={boxDestFilter} onChange={e => setBoxDestFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                  <option value="">Tüm Hedefler</option>
                  <option value="FBA">FBA</option>
                  <option value="DEPO">Depo</option>
                </select>
                {boxMarkets.length > 1 && (
                  <select value={boxMarketFilter} onChange={e => setBoxMarketFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                    <option value="">Tüm Pazarlar</option>
                    {boxMarkets.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </>
            )}
            {/* Bulk FBA/DEPO toggle */}
            {canDest && selectedBoxIds.size > 0 && (
              <>
                <button onClick={() => handleSetDestination('FBA')} disabled={settingDest}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50">
                  {settingDest ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {selectedBoxIds.size} koli → FBA
                </button>
                <button onClick={() => handleSetDestination('DEPO')} disabled={settingDest}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50">
                  {selectedBoxIds.size} koli → Depo
                </button>
              </>
            )}
          </div>
          {showExtraBox && (
            <ExtraBoxForm onSubmit={async (form) => { const r = await handleCreateBox(form, null); if (r) setShowExtraBox(false); }} onCancel={() => setShowExtraBox(false)} />
          )}
          {showBulkFba && (
            <div className="bg-white border border-orange-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Toplu FBA / Depo İşaretleme</h3>
                <button onClick={() => { setShowBulkFba(false); setBulkFbaResult(null); }} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-gray-500">Koli numaralarını alt alta, virgül veya tab ile ayırarak girin:</p>
              <textarea
                value={bulkFbaText}
                onChange={e => setBulkFbaText(e.target.value)}
                placeholder={"69-0001\n69-0002\n69-0003"}
                rows={6}
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono resize-y"
              />
              <div className="flex items-center gap-3">
                <button onClick={() => handleBulkFbaSubmit('FBA')} disabled={settingDest || !bulkFbaText.trim()}
                  className="px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2">
                  {settingDest && <Loader2 className="w-4 h-4 animate-spin" />} FBA Olarak İşaretle
                </button>
                <button onClick={() => handleBulkFbaSubmit('DEPO')} disabled={settingDest || !bulkFbaText.trim()}
                  className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  Depo Olarak İşaretle
                </button>
              </div>
              {bulkFbaResult && (
                <div className="text-sm">
                  <p className="text-green-700">{bulkFbaResult.updated} koli güncellendi.</p>
                  {bulkFbaResult.notFound && bulkFbaResult.notFound.length > 0 && (
                    <p className="text-red-600 mt-1">Bulunamayan: {bulkFbaResult.notFound.join(', ')}</p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="bg-white border rounded-xl overflow-hidden">
            {boxes.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <button onClick={handleSelectAllBoxes} className="text-gray-600 hover:text-purple-600">
                        {selectedBoxIds.size === boxes.length && boxes.length > 0 ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                      </button>
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Koli No</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Hedef</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Ürün Adı</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Adet</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">En</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Boy</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Yuk.</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Agr.</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Desi</th>
                    <th className="w-8"></th>
                    <th className="w-10"></th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredBoxes.map(box => {
                    const boxDesi = (box.width && box.depth && box.height) ? (box.width * box.depth * box.height / 5000) : null;
                    const isFba = box.destination === 'FBA';
                    return (
                      <tr key={box.id} className={`hover:bg-gray-50 ${isFba ? 'bg-orange-50/40' : ''}`}>
                        <td className="px-3 py-3 text-center">
                          <button onClick={() => handleToggleBoxSelect(box.id)} className="hover:scale-110 transition-transform">
                            {selectedBoxIds.has(box.id) ? <CheckSquare className="w-5 h-5 text-purple-600" /> : <Square className="w-5 h-5 text-gray-300" />}
                          </button>
                        </td>
                        <td className="px-3 py-3 font-mono text-sm font-semibold text-gray-900">{box.boxNumber}</td>
                        <td className="px-3 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${isFba ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                            {isFba ? 'FBA' : 'Depo'}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-mono text-sm text-gray-700">{box.iwasku || '—'}</td>
                        <td className="px-3 py-3 font-mono text-sm text-gray-600">
                          <span className="inline-flex items-center gap-1">
                            {box.fnsku || '—'}
                            {canBoxes && box.fnsku && (
                              <button
                                onClick={() => handleSyncFnsku(box.id)}
                                disabled={syncingFnskuBoxId === box.id}
                                className="text-gray-300 hover:text-blue-500 transition-colors"
                                title="FNSKU güncelle (sku_master'dan)">
                                <RefreshCw className={`w-3 h-3 ${syncingFnskuBoxId === box.id ? 'animate-spin text-blue-500' : ''}`} />
                              </button>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-700 line-clamp-1">{box.productName || '—'}</td>
                        <td className="px-3 py-3 text-sm text-gray-600">{(box.marketplaceCode && mktCodeToName.get(box.marketplaceCode)) || box.marketplaceCode || '—'}</td>
                        <td className="text-center px-3 py-3 font-semibold">{box.quantity}</td>
                        <EditableBoxCell boxId={box.id} shipmentId={id} field="width" value={box.width} canEdit={isActive && canBoxes} onUpdated={fetchBoxes}
                          editingCell={editingCell} setEditingCell={setEditingCell} visibleBoxes={filteredBoxes} />
                        <EditableBoxCell boxId={box.id} shipmentId={id} field="depth" value={box.depth} canEdit={isActive && canBoxes} onUpdated={fetchBoxes}
                          editingCell={editingCell} setEditingCell={setEditingCell} visibleBoxes={filteredBoxes} />
                        <EditableBoxCell boxId={box.id} shipmentId={id} field="height" value={box.height} canEdit={isActive && canBoxes} onUpdated={fetchBoxes}
                          editingCell={editingCell} setEditingCell={setEditingCell} visibleBoxes={filteredBoxes} />
                        <EditableBoxCell boxId={box.id} shipmentId={id} field="weight" value={box.weight} canEdit={isActive && canBoxes} onUpdated={fetchBoxes}
                          editingCell={editingCell} setEditingCell={setEditingCell} visibleBoxes={filteredBoxes} />
                        <td className="text-center px-3 py-3 font-medium text-gray-900">{boxDesi ? boxDesi.toFixed(1) : '—'}</td>
                        {(() => {
                          const donorKey = `${box.iwasku}|${box.quantity}`;
                          const donor = donorMap.get(donorKey);
                          const needsCopy = donor && donor.id !== box.id && (!box.width || !box.depth || !box.height || !box.weight);
                          return (
                            <td className="px-1 py-3 text-center">
                              {isActive && canBoxes && needsCopy ? (
                                <button onClick={() => handleCopyDimensions(box, donor)}
                                  className="text-blue-400 hover:text-blue-600 transition-colors"
                                  title={`Ölçüleri kopyala (${donor.width}×${donor.depth}×${donor.height}, ${donor.weight}kg)`}>
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              ) : null}
                            </td>
                          );
                        })()}
                        <td className="px-2 py-3 text-center">
                          <button onClick={() => handlePrintBoxLabel(box)}
                            className={`transition-colors ${printedBoxIds.has(box.id) ? 'text-green-500 hover:text-green-700' : 'text-gray-400 hover:text-blue-600'}`}
                            title={printedBoxIds.has(box.id) ? 'Basıldı — tekrar bas' : 'Etiket bas'}>
                            <Printer className="w-4 h-4" />
                          </button>
                        </td>
                        <td className="px-2 py-3">{isActive && canBoxes && <button onClick={() => handleDeleteBox(box.id)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-12"><Package className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">Henüz koli eklenmedi</p></div>
            )}
          </div>
        </div>
      )}

      {/* === DEPO ÇIKIŞ ONAY MODALI === */}
      {showExitModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">Depo Çıkışı</h3>
              <button onClick={() => setShowExitModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Hafta (Pazartesi)</label>
                <input type="date" value={exitWeek} onChange={e => setExitWeek(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm w-44" />
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">IWASKU</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">Ürün Adı</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-600">Adet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {exitItems.slice(exitPage * 10, (exitPage + 1) * 10).map(item => (
                      <tr key={item.iwasku}>
                        <td className="px-4 py-2 font-mono text-sm">{item.iwasku}</td>
                        <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[200px]">{item.name}</td>
                        <td className="px-4 py-2 text-sm font-semibold text-right">{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {exitItems.length > 10 && (
                <div className="flex items-center justify-between">
                  <button onClick={() => setExitPage(p => Math.max(0, p - 1))} disabled={exitPage === 0}
                    className="px-3 py-1 text-xs border rounded disabled:opacity-30">Önceki</button>
                  <span className="text-xs text-gray-500">{exitPage + 1} / {Math.ceil(exitItems.length / 10)}</span>
                  <button onClick={() => setExitPage(p => Math.min(Math.ceil(exitItems.length / 10) - 1, p + 1))} disabled={exitPage >= Math.ceil(exitItems.length / 10) - 1}
                    className="px-3 py-1 text-xs border rounded disabled:opacity-30">Sonraki</button>
                </div>
              )}
              <p className="text-sm text-gray-500">
                Toplam: <span className="font-semibold text-gray-900">{exitItems.reduce((s, i) => s + i.quantity, 0)}</span> adet
                ({exitItems.length} ürün)
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
              <button onClick={() => setShowExitModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Atla
              </button>
              <button onClick={handleConfirmExit} disabled={exitSaving || !exitWeek}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {exitSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Onayla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Editable Box Cell (dimensions/weight) with Tab navigation ---
const FIELD_ORDER: ('width' | 'depth' | 'height' | 'weight')[] = ['width', 'depth', 'height', 'weight'];

function EditableBoxCell({ boxId, shipmentId, field, value, canEdit, onUpdated, editingCell, setEditingCell, visibleBoxes }: {
  boxId: string; shipmentId: string; field: 'width' | 'height' | 'depth' | 'weight';
  value: number | null; canEdit: boolean; onUpdated: () => void;
  editingCell: { boxId: string; field: 'width' | 'depth' | 'height' | 'weight' } | null;
  setEditingCell: (cell: { boxId: string; field: 'width' | 'depth' | 'height' | 'weight' } | null) => void;
  visibleBoxes: ShipmentBox[];
}) {
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);
  const tabNavigating = useRef(false);
  const isEditing = editingCell?.boxId === boxId && editingCell?.field === field;

  // Tab navigation ile açıldığında inputVal'ı set et
  useEffect(() => {
    if (isEditing) setInputVal(value?.toString() ?? '');
  }, [isEditing, value]);

  const navigateCell = (direction: 1 | -1) => {
    const fieldIdx = FIELD_ORDER.indexOf(field);
    const boxIdx = visibleBoxes.findIndex(b => b.id === boxId);
    let nextField = fieldIdx + direction;
    let nextBoxIdx = boxIdx;
    if (nextField >= FIELD_ORDER.length) { nextField = 0; nextBoxIdx++; }
    else if (nextField < 0) { nextField = FIELD_ORDER.length - 1; nextBoxIdx--; }
    if (nextBoxIdx >= 0 && nextBoxIdx < visibleBoxes.length) {
      setEditingCell({ boxId: visibleBoxes[nextBoxIdx].id, field: FIELD_ORDER[nextField] });
    } else {
      setEditingCell(null);
    }
  };

  const handleSave = async (andNavigate?: 1 | -1) => {
    const num = inputVal.trim() ? parseFloat(inputVal) : null;
    if (num !== null && (isNaN(num) || num <= 0)) {
      if (andNavigate) navigateCell(andNavigate); else setEditingCell(null);
      return;
    }
    if (num === value) {
      if (andNavigate) navigateCell(andNavigate); else setEditingCell(null);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/boxes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId, [field]: num }),
      });
      if ((await res.json()).success) onUpdated();
    } catch { /* */ }
    finally {
      setSaving(false);
      if (andNavigate) navigateCell(andNavigate); else setEditingCell(null);
    }
  };

  if (!canEdit) {
    return <td className="text-center px-3 py-3 text-gray-600">{value ?? '—'}</td>;
  }

  if (isEditing) {
    return (
      <td className="text-center px-1 py-1">
        <input
          type="number" step="0.1" autoFocus
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Tab') { e.preventDefault(); tabNavigating.current = true; handleSave(e.shiftKey ? -1 : 1); }
            else if (e.key === 'Enter') { tabNavigating.current = true; handleSave(1); }
            else if (e.key === 'Escape') setEditingCell(null);
          }}
          onBlur={() => { if (!saving && !tabNavigating.current) handleSave(); tabNavigating.current = false; }}
          disabled={saving}
          className="w-14 px-1 py-0.5 border border-blue-300 rounded text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </td>
    );
  }

  return (
    <td
      className="text-center px-3 py-3 text-gray-600 cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition-colors"
      onClick={() => setEditingCell({ boxId, field })}
      title="Düzenlemek için tıkla"
    >
      {value ?? '—'}
    </td>
  );
}

// --- Inline FNSKU Input ---
const MKT_CODE_TO_COUNTRY: Record<string, string> = {
  AMZN_US: 'US', AMZN_CA: 'CA', AMZN_UK: 'UK', AMZN_AU: 'AU', AMZN_EU: 'FR',
};

function InlineFnskuInput({ item, onSaved }: { item: ShipmentItem; onSaved: (itemId: string, fnsku: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const fnsku = value.trim();
    if (!fnsku) { setEditing(false); return; }
    const countryCode = item.marketplace?.code ? MKT_CODE_TO_COUNTRY[item.marketplace.code] : null;
    if (!countryCode) { setError('Marketplace eşleştirilemedi'); return; }

    setSaving(true); setError('');
    try {
      const res = await fetch('/api/sku-master/fnsku', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentItemId: item.id, iwasku: item.iwasku, countryCode, fnsku }),
      });
      const data = await res.json();
      if (data.success) {
        onSaved(item.id, data.data.fnsku ?? fnsku);
        setEditing(false);
      } else {
        setError(data.error || 'Hata');
      }
    } catch { setError('Bağlantı hatası'); } finally { setSaving(false); }
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setEditing(true); setValue(''); setError(''); }}
        className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium hover:bg-amber-200 transition-colors cursor-pointer"
        title="FNSKU girmek için tıkla"
      >
        Eksik
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
          placeholder="FNSKU"
          disabled={saving}
          className="px-1.5 py-0.5 border border-amber-300 rounded text-xs font-mono w-28 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
        {saving ? (
          <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
        ) : (
          <>
            <button onClick={handleSave} className="text-green-600 hover:text-green-800"><Check className="w-3.5 h-3.5" /></button>
            <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
          </>
        )}
      </div>
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

// --- Pending Item Row ---
function PendingItemRow({ item, itemDesi, itemBoxes, isSea, isActive, isExpanded, isSelected, togglingId,
  canBoxes, canPack, canSend, canDelete,
  onTogglePacked, onToggleSelect, onToggleExpand, onCreateBox, onDeleteBox, onDeleteItem, onFnskuSaved,
  onPrintLabel }: {
  item: ShipmentItem; itemDesi: number; itemBoxes: ShipmentBox[];
  isSea: boolean; isActive: boolean; isExpanded: boolean; isSelected: boolean; togglingId: string | null;
  canBoxes: boolean; canPack: boolean; canSend: boolean; canDelete: boolean;
  onTogglePacked: () => void; onToggleSelect: () => void; onToggleExpand: () => void;
  onCreateBox: (form: BoxFormData) => Promise<ShipmentBox | null>; onDeleteBox: (boxId: string) => void;
  onDeleteItem: () => void;
  onFnskuSaved: (itemId: string, fnsku: string) => void;
  onPrintLabel: (item: ShipmentItem, count: number) => void;
}) {
  // Deniz renk kodlama: kolilerdeki toplam adet vs item miktar
  const boxQtyTotal = itemBoxes.reduce((s, b) => s + b.quantity, 0);
  const rowBg = isSea
    ? (itemBoxes.length === 0 ? '' : boxQtyTotal >= item.quantity ? 'bg-green-50' : 'bg-amber-50/60')
    : (item.packed ? 'bg-green-50/50' : '');

  return (
    <>
      <tr className={`hover:bg-gray-50 ${rowBg}`}>
        <td className="px-3 py-3 text-center">
          {isActive && isSea && canBoxes ? (
            <button onClick={onToggleExpand} className="hover:scale-110 transition-transform">
              {isExpanded ? <ChevronDown className="w-5 h-5 text-blue-600" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
            </button>
          ) : isActive && !isSea ? (
            <div className="flex items-center gap-1 justify-center">
              {item.packed && canSend && (
                <button onClick={onToggleSelect} className="hover:scale-110 transition-transform">
                  {isSelected ? <CheckSquare className="w-5 h-5 text-purple-600" /> : <Square className="w-5 h-5 text-gray-300" />}
                </button>
              )}
              {canPack && (togglingId === item.id ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (
                <button onClick={onTogglePacked} className="hover:scale-110 transition-transform" title={item.packed ? 'Hazır' : 'Hazırla'}>
                  {item.packed ? <Check className="w-4 h-4 text-green-600" /> : <Package className="w-4 h-4 text-gray-300" />}
                </button>
              ))}
            </div>
          ) : item.packed ? <Check className="w-5 h-5 text-green-600" /> : null}
        </td>
        <td className={`px-3 py-3 font-mono text-sm ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{item.iwasku}</td>
        <td className="px-3 py-3">
          {item.fnsku
            ? <span className={`font-mono text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>{item.fnsku}</span>
            : item.marketplace?.code?.startsWith('AMZN')
              ? <InlineFnskuInput item={item} onSaved={onFnskuSaved} />
              : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-3 py-3"><div className={`text-xs leading-tight line-clamp-2 ${item.packed ? 'text-green-700' : 'text-gray-700'}`}>{item.productName || '—'}</div></td>
        <td className={`px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>{item.productCategory || '—'}</td>
        <td className={`px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>{item.marketplace?.name ?? '—'}</td>
        <td className={`text-center px-3 py-3 font-semibold ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{item.quantity}</td>
        <td className={`text-center px-3 py-3 font-medium ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{itemDesi > 0 ? Math.round(itemDesi).toLocaleString('tr-TR') : '—'}</td>
        {isActive && (
          <td className="px-2 py-3 text-center">
            <div className="flex items-center gap-1 justify-center">
              {!isSea && (item.fnsku || item.iwasku) && (
                <button onClick={() => {
                  const input = prompt(`${item.iwasku} — Kaç etiket basılsın?`, String(item.quantity));
                  if (input) { const n = parseInt(input); if (n > 0) onPrintLabel(item, n); }
                }} className="text-gray-300 hover:text-blue-600 transition-colors" title="Etiket yazdır">
                  <Printer className="w-4 h-4" />
                </button>
              )}
              {canDelete && (
                <button onClick={onDeleteItem} className="text-red-300 hover:text-red-600 transition-colors" title="Sevkiyattan çıkar"><X className="w-4 h-4" /></button>
              )}
            </div>
          </td>
        )}
      </tr>
      {isExpanded && isActive && isSea && canBoxes && (
        <tr><td colSpan={10} className="px-4 py-3 bg-blue-50/50 border-t border-blue-100">
          <BoxEntryPanel item={item} existingBoxes={itemBoxes} onCreateBox={onCreateBox} onDeleteBox={onDeleteBox} />
        </td></tr>
      )}
    </>
  );
}

// --- Box Entry Panel ---
function BoxEntryPanel({ item, existingBoxes, onCreateBox, onDeleteBox }: {
  item: ShipmentItem; existingBoxes: ShipmentBox[];
  onCreateBox: (form: BoxFormData) => Promise<ShipmentBox | null>; onDeleteBox: (boxId: string) => void;
}) {
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [width, setWidth] = useState(''); const [height, setHeight] = useState('');
  const [depth, setDepth] = useState(''); const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await onCreateBox({ iwasku: item.iwasku, fnsku: item.fnsku, productName: item.productName, productCategory: item.productCategory,
        marketplaceCode: item.marketplace?.code ?? null, quantity: parseInt(quantity) || 1,
        width: width ? parseFloat(width) : null, height: height ? parseFloat(height) : null,
        depth: depth ? parseFloat(depth) : null, weight: weight ? parseFloat(weight) : null });
      setQuantity(String(item.quantity)); setWidth(''); setHeight(''); setDepth(''); setWeight('');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      {existingBoxes.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500 mb-1">Mevcut koliler:</p>
          {existingBoxes.map(box => (
            <div key={box.id} className="flex items-center gap-3 text-xs bg-white rounded px-3 py-1.5 border">
              <span className="font-mono font-semibold text-gray-900">{box.boxNumber}</span>
              <span className="text-gray-500">{box.quantity} adet</span>
              {box.width && <span className="text-gray-500">{box.width}x{box.depth}x{box.height}cm</span>}
              {box.weight && <span className="text-gray-500">{box.weight}kg</span>}
              <button onClick={() => onDeleteBox(box.id)} className="ml-auto text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-end">
        <div><label className="block text-xs text-gray-500 mb-0.5">Adet</label><input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-16" required /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">En</label><input type="number" step="0.1" value={width} onChange={e => setWidth(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Boy</label><input type="number" step="0.1" value={depth} onChange={e => setDepth(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Yükseklik</label><input type="number" step="0.1" value={height} onChange={e => setHeight(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Ağırlık</label><input type="number" step="0.01" value={weight} onChange={e => setWeight(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Koli Ekle</button>
      </form>
    </div>
  );
}

// --- Extra Box Form ---
function ExtraBoxForm({ onSubmit, onCancel }: { onSubmit: (form: BoxFormData) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState({ iwasku: '', fnsku: '', productName: '', productCategory: '', marketplaceCode: '', quantity: '1', count: '1', width: '', height: '', depth: '', weight: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const count = parseInt(f.count) || 1;
      for (let i = 0; i < count; i++) {
        await onSubmit({
          iwasku: f.iwasku || null, fnsku: f.fnsku || null,
          productName: f.productName || null, productCategory: f.productCategory || null,
          marketplaceCode: f.marketplaceCode || null, quantity: parseInt(f.quantity) || 1,
          width: f.width ? parseFloat(f.width) : null, height: f.height ? parseFloat(f.height) : null,
          depth: f.depth ? parseFloat(f.depth) : null, weight: f.weight ? parseFloat(f.weight) : null,
        });
      }
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-blue-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Ek Koli (Üretim Dışı)</h3>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap gap-3">
        <div><label className="block text-xs text-gray-500 mb-0.5">IWASKU</label>
          <input type="text" value={f.iwasku} onChange={e => setF(p => ({ ...p, iwasku: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-40" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">FNSKU</label>
          <input type="text" value={f.fnsku} onChange={e => setF(p => ({ ...p, fnsku: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-32 font-mono" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Ürün Adı</label>
          <input type="text" value={f.productName} onChange={e => setF(p => ({ ...p, productName: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-48" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Kategori</label>
          <input type="text" value={f.productCategory} onChange={e => setF(p => ({ ...p, productCategory: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-36" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Pazar Yeri</label>
          <input type="text" value={f.marketplaceCode} onChange={e => setF(p => ({ ...p, marketplaceCode: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-24" /></div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div><label className="block text-xs text-gray-500 mb-0.5">Adet/Koli</label>
          <input type="number" value={f.quantity} onChange={e => setF(p => ({ ...p, quantity: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-16" required /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">En</label>
          <input type="number" step="0.1" value={f.width} onChange={e => setF(p => ({ ...p, width: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Boy</label>
          <input type="number" step="0.1" value={f.depth} onChange={e => setF(p => ({ ...p, depth: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Yükseklik</label>
          <input type="number" step="0.1" value={f.height} onChange={e => setF(p => ({ ...p, height: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Ağırlık</label>
          <input type="number" step="0.01" value={f.weight} onChange={e => setF(p => ({ ...p, weight: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Çoğalt</label>
          <input type="number" min="1" max="200" value={f.count} onChange={e => setF(p => ({ ...p, count: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-16" /></div>
        <button type="submit" disabled={saving} className="self-end px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {parseInt(f.count) > 1 ? `${f.count} Koli Ekle` : 'Koli Ekle'}
        </button>
      </div>
    </form>
  );
}

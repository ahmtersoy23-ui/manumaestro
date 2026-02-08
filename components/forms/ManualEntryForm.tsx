/**
 * Manual Entry Form Component
 * Form for manually entering production requests
 */

'use client';

import { useState, useEffect } from 'react';
import { Search, Plus, Check, Calendar, AlertCircle } from 'lucide-react';
import { getAvailableMonths, formatMonthDisplay, getCurrentMonth } from '@/lib/monthUtils';

interface ManualEntryFormProps {
  marketplaceId: string;
  marketplaceName: string;
  onSuccess?: () => void;
}

interface Product {
  iwasku: string;
  name: string;
  category: string | null;
}

export function ManualEntryForm({ marketplaceId, marketplaceName, onSuccess }: ManualEntryFormProps) {
  const [iwasku, setIwasku] = useState('');
  const [quantity, setQuantity] = useState('');
  const [productName, setProductName] = useState('');
  const [productCategory, setProductCategory] = useState('');
  const [productionMonth, setProductionMonth] = useState('');
  const [notes, setNotes] = useState('');
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [monthError, setMonthError] = useState('');

  const availableMonths = getAvailableMonths();
  const today = new Date();
  const dayOfMonth = today.getDate();
  const currentMonth = getCurrentMonth();

  // Auto-select appropriate month on mount
  useEffect(() => {
    if (!productionMonth && availableMonths.length > 0) {
      if (dayOfMonth > 5) {
        // After 5th, default to next month
        const nextMonth = availableMonths.find(m => m.value > currentMonth);
        setProductionMonth(nextMonth?.value || availableMonths[1]?.value || availableMonths[0].value);
      } else {
        // Before or on 5th, default to current month
        setProductionMonth(currentMonth);
      }
    }
  }, [availableMonths]);

  // Debounced search
  useEffect(() => {
    if (iwasku.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(iwasku)}`);
        const data = await res.json();

        if (data.success) {
          setSearchResults(data.data);
          setShowDropdown(true);
        }
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [iwasku]);

  const selectProduct = (product: Product) => {
    setIwasku(product.iwasku);
    setProductName(product.name);
    setProductCategory(product.category || 'Uncategorized');
    setShowDropdown(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!productName) {
      alert('Please select a valid product');
      return;
    }

    // Validate: Cannot enter for current month after 5th
    if (dayOfMonth > 5 && productionMonth === currentMonth) {
      setMonthError('Cannot enter requests for current month after the 5th. Please select next month.');
      return;
    }

    setMonthError('');
    setSubmitting(true);
    setSuccess(false);

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          iwasku,
          productName,
          productCategory,
          marketplaceId,
          quantity: parseInt(quantity),
          productionMonth,
          notes,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(true);
        // Reset form
        setIwasku('');
        setQuantity('');
        setProductName('');
        setProductCategory('');
        setNotes('');
        setSearchResults([]);

        // Hide success message after 3 seconds
        setTimeout(() => setSuccess(false), 3000);

        // Trigger callback to refresh the table
        if (onSuccess) {
          onSuccess();
        }
      } else {
        alert(data.error || 'Failed to create request');
      }
    } catch (error) {
      console.error('Submit error:', error);
      alert('Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
          <Check className="w-5 h-5 text-green-600" />
          <p className="text-sm font-medium text-green-900">
            Request successfully added!
          </p>
        </div>
      )}

      {/* Production Month Warning */}
      {dayOfMonth > 5 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-orange-900 mb-1">
              Current Month Entry Closed
            </p>
            <p className="text-sm text-orange-800">
              Today is the {dayOfMonth}th. Requests for {formatMonthDisplay(currentMonth)} are now closed.
              Please enter for next month.
            </p>
          </div>
        </div>
      )}

      {/* Month Selection Error */}
      {monthError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-sm font-medium text-red-900">{monthError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Production Month Selector */}
        <div>
          <label htmlFor="productionMonth" className="block text-sm font-medium text-gray-700 mb-2">
            Production Month *
          </label>
          <div className="relative">
            <select
              id="productionMonth"
              value={productionMonth}
              onChange={(e) => {
                setProductionMonth(e.target.value);
                setMonthError('');
              }}
              className="w-full px-4 py-2 pl-10 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all appearance-none bg-white cursor-pointer"
              required
            >
              {availableMonths.map((month) => (
                <option
                  key={month.value}
                  value={month.value}
                  disabled={dayOfMonth > 5 && month.value === currentMonth}
                  className="text-gray-900"
                >
                  {month.label}
                  {dayOfMonth > 5 && month.value === currentMonth && ' (Closed)'}
                </option>
              ))}
            </select>
            <Calendar className="absolute left-3 top-2.5 w-5 h-5 text-gray-400 pointer-events-none" />
            <div className="absolute right-3 top-2.5 pointer-events-none">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Quantity Input */}
        <div>
          <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-2">
            Quantity *
          </label>
          <input
            type="number"
            id="quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Enter quantity"
            min="1"
            className={`w-full px-4 py-2 border-2 rounded-lg focus:ring-2 focus:ring-purple-500 transition-all ${
              quantity
                ? 'border-purple-400 bg-purple-50 font-bold text-gray-900'
                : 'border-gray-300 focus:border-purple-400'
            }`}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* IWASKU Input with Search */}
        <div className="relative">
          <label htmlFor="iwasku" className="block text-sm font-medium text-gray-700 mb-2">
            IWASKU / Product SKU *
          </label>
          <div className="relative">
            <input
              type="text"
              id="iwasku"
              value={iwasku}
              onChange={(e) => setIwasku(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              placeholder="Type to search products..."
              className={`w-full px-4 py-2 pl-10 border-2 rounded-lg focus:ring-2 focus:ring-purple-500 transition-all ${
                productName
                  ? 'border-purple-400 bg-purple-50 font-bold text-gray-900'
                  : 'border-gray-300 focus:border-purple-400'
              }`}
              required
              autoComplete="off"
            />
            <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
            {searching && (
              <div className="absolute right-3 top-2.5">
                <div className="w-5 h-5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>

          {/* Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border-2 border-purple-300 rounded-lg shadow-xl max-h-64 overflow-y-auto">
              {searchResults.map((product) => (
                <button
                  key={product.iwasku}
                  type="button"
                  onClick={() => selectProduct(product)}
                  className="w-full px-4 py-3 text-left hover:bg-purple-100 transition-colors border-b border-gray-200 last:border-b-0"
                >
                  <p className="text-sm font-mono font-bold text-gray-900">{product.iwasku}</p>
                  <p className="text-sm text-gray-800 font-semibold mt-1 leading-snug">{product.name}</p>
                  {product.category && (
                    <p className="text-xs text-purple-700 font-semibold mt-1 bg-purple-50 inline-block px-2 py-0.5 rounded">{product.category}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Auto-populated fields */}
      {productName && (
        <div className="bg-purple-50 border-2 border-purple-300 rounded-lg p-5">
          <h4 className="text-base font-bold text-purple-900 mb-4 flex items-center gap-2">
            <Check className="w-5 h-5" />
            Product Details (Auto-populated)
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-purple-800 mb-1.5 uppercase tracking-wide">
                Product Name
              </label>
              <p className="text-base text-purple-950 font-semibold leading-snug">
                {productName}
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-purple-800 mb-1.5 uppercase tracking-wide">
                Category
              </label>
              <p className="text-base text-purple-950 font-semibold">
                {productCategory || 'Uncategorized'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Notes (Optional) */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
          Notes (Optional)
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add any additional notes or comments"
          rows={3}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        />
      </div>

      {/* Submit Button */}
      <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={() => {
            setIwasku('');
            setQuantity('');
            setProductName('');
            setProductCategory('');
            setNotes('');
            setSearchResults([]);
            setMonthError('');
          }}
          className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Clear
        </button>
        <button
          type="submit"
          disabled={!iwasku || !quantity || !productName || !productionMonth || submitting}
          className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              Add Request
            </>
          )}
        </button>
      </div>
    </form>
  );
}

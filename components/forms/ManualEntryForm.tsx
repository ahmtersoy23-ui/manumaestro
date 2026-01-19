/**
 * Manual Entry Form Component
 * Form for manually entering production requests
 */

'use client';

import { useState } from 'react';
import { Search, Plus } from 'lucide-react';

interface ManualEntryFormProps {
  marketplaceSlug: string;
}

export function ManualEntryForm({ marketplaceSlug }: ManualEntryFormProps) {
  const [iwasku, setIwasku] = useState('');
  const [quantity, setQuantity] = useState('');
  const [productName, setProductName] = useState('');
  const [productCategory, setProductCategory] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // TODO: API call to save request
    console.log('Submitting request:', {
      marketplaceSlug,
      iwasku,
      quantity,
      notes,
    });

    // Reset form
    setIwasku('');
    setQuantity('');
    setProductName('');
    setProductCategory('');
    setNotes('');
  };

  const handleIwaskuSearch = async (value: string) => {
    setIwasku(value);

    if (value.length >= 3) {
      // TODO: Search products from pricelab_db
      // Mock data for now
      setProductName('Sample Product Name');
      setProductCategory('Sample Category');
    } else {
      setProductName('');
      setProductCategory('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* IWASKU Input with Search */}
        <div>
          <label htmlFor="iwasku" className="block text-sm font-medium text-gray-700 mb-2">
            IWASKU *
          </label>
          <div className="relative">
            <input
              type="text"
              id="iwasku"
              value={iwasku}
              onChange={(e) => handleIwaskuSearch(e.target.value)}
              placeholder="Enter or search IWASKU"
              className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              required
            />
            <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Start typing to search products
          </p>
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
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            required
          />
        </div>
      </div>

      {/* Auto-populated fields */}
      {productName && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-purple-900 mb-3">
            Product Details (Auto-populated)
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-purple-700 mb-1">
                Product Name
              </label>
              <p className="text-sm text-purple-900 font-medium">
                {productName}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-purple-700 mb-1">
                Category
              </label>
              <p className="text-sm text-purple-900 font-medium">
                {productCategory}
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
          }}
          className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Clear
        </button>
        <button
          type="submit"
          disabled={!iwasku || !quantity || !productName}
          className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Request
        </button>
      </div>
    </form>
  );
}

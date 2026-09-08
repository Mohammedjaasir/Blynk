import React from 'react';

export const ProductCardSkeleton: React.FC = () => {
  return (
    <div className="bg-white rounded-2xl p-3 border border-gray-100 shadow-xs flex flex-col justify-between h-56 animate-pulse">
      <div className="w-full h-28 bg-gray-200 rounded-xl mb-2 skeleton-shimmer" />
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-1 skeleton-shimmer" />
      <div className="h-3 bg-gray-100 rounded w-1/2 mb-3 skeleton-shimmer" />
      <div className="flex items-center justify-between mt-auto">
        <div className="h-4 bg-gray-200 rounded w-12 skeleton-shimmer" />
        <div className="h-7 bg-gray-200 rounded-xl w-16 skeleton-shimmer" />
      </div>
    </div>
  );
};

export const TableRowSkeleton: React.FC = () => {
  return (
    <tr className="animate-pulse border-b border-gray-100">
      <td className="p-4"><div className="h-4 bg-gray-200 rounded w-20 skeleton-shimmer" /></td>
      <td className="p-4"><div className="h-4 bg-gray-200 rounded w-32 skeleton-shimmer" /></td>
      <td className="p-4"><div className="h-4 bg-gray-200 rounded w-16 skeleton-shimmer" /></td>
      <td className="p-4"><div className="h-4 bg-gray-200 rounded w-24 skeleton-shimmer" /></td>
      <td className="p-4"><div className="h-6 bg-gray-200 rounded-full w-20 skeleton-shimmer" /></td>
    </tr>
  );
};

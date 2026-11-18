import type { Metadata } from 'next';

import { ProductListing, type ListingSearchParams } from '@/components/shop/product-listing';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search the full product catalogue.',
};

/** /search -- full-catalogue search and browse. */
const SearchPage = async ({
  searchParams,
}: {
  searchParams: Promise<ListingSearchParams>;
}) => {
  const params = await searchParams;
  const term = Array.isArray(params.q) ? params.q[0] : params.q;

  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-6">
      <ProductListing
        searchParams={params}
        basePath="/search"
        heading={term ? `Search results` : 'All products'}
        emptyTitle={term ? 'Nothing found' : 'The catalogue is empty'}
        emptyDescription={
          term
            ? 'Try a shorter or more general search term.'
            : 'Products added in the back office appear here straight away.'
        }
      />
    </div>
  );
};

export default SearchPage;

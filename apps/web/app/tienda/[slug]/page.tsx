import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ListingView, PAGE_SIZE, UnavailableNotice } from '@/components/listing-view';
import { SearchForm } from '@/components/search-form';
import { ApiError, getMerchantListing } from '@/lib/api';
import { parseListingParams, toApiParams, type RawParams } from '@/lib/listing-params';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawParams>;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

async function load(slug: string, raw: RawParams) {
  if (!SLUG.test(slug)) notFound();
  const state = parseListingParams(raw);
  try {
    return { state, data: await getMerchantListing(slug, toApiParams(state, PAGE_SIZE)) };
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'not_found') notFound();
    if (err instanceof ApiError) return { state, data: null };
    throw err;
  }
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { data, state } = await load(slug, await searchParams);
  const name = data?.merchant.name ?? 'Tienda';
  return {
    title: `${name}: precios`,
    description: `Productos y precios de ${name}, comparados con las demás tiendas.`,
    alternates: { canonical: `/tienda/${slug}` },
    robots: state.page > 1 || state.brands.length ? { index: false, follow: true } : undefined,
  };
}

/** Tienda SSR (§11): productos con oferta vigente de la tienda, con su precio en ella con filtros y orden en la URL. */
export default async function MerchantPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { state, data } = await load(slug, await searchParams);
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <SearchForm />
      {data ? (
        <>
          <h1 className="text-2xl font-bold sm:text-3xl">{data.merchant.name}</h1>
          <ListingView
            path={`/tienda/${data.merchant.slug}`}
            state={{ ...state, q: '' }}
            total={data.total}
            results={data.results}
            facets={data.facets}
            showMerchantFacet={false}
            empty={<p className="text-lg font-semibold">No hay productos con estos filtros.</p>}
          />
        </>
      ) : (
        <UnavailableNotice />
      )}
    </section>
  );
}

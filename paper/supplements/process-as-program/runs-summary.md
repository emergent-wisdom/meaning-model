# Runs of the office program

Month 0 is January 1852. Every value below is computed by the laws in `office.model.json`; none was entered by hand.

## Limit the office to two jobs a month

Model 358ca90c879fc58a.

| Month | Ordered h | Capacity h | Backlog h | Queue (months) | Jobs out unchecked |
|---|---|---|---|---|---|
| Jan 1852 | 80 | 80 | 0 | 0.00 | 0 |
| Apr 1852 | 80 | 80 | 0 | 0.00 | 0 |
| May 1852 | 80 | 80 | 0 | 0.00 | 0 |
| Jul 1852 | 80 | 80 | 0 | 0.00 | 0 |
| Aug 1852 | 80 | 80 | 0 | 0.00 | 0 |
| Sep 1852 | 80 | 80 | 0 | 0.00 | 0 |
| Jan 1853 | 80 | 80 | 0 | 0.00 | 0 |
| Jan 1854 | 80 | 80 | 0 | 0.00 | 0 |
| Jan 1855 | 80 | 80 | 0 | 0.00 | 0 |

No job is delivered unchecked.

## Accept four jobs a month

Model 2424a8e3a61c9b92.

| Month | Ordered h | Capacity h | Backlog h | Queue (months) | Jobs out unchecked |
|---|---|---|---|---|---|
| Jan 1852 | 160 | 80 | 0 | 0.00 | 0 |
| Apr 1852 | 160 | 80 | 240 | 3.00 | 0 |
| May 1852 | 160 | 80 | 240 | 3.00 | 2 |
| Jul 1852 | 160 | 80 | 240 | 3.00 | 6 |
| Aug 1852 | 160 | 80 | 240 | 3.00 | 8 |
| Sep 1852 | 160 | 80 | 240 | 3.00 | 10 |
| Jan 1853 | 160 | 80 | 240 | 3.00 | 18 |
| Jan 1854 | 160 | 80 | 240 | 3.00 | 42 |
| Jan 1855 | 160 | 80 | 240 | 3.00 | 66 |

First job delivered unchecked: month 3.25 (Apr 1852).

## Accept four jobs; fund a second checker from August 1852

Model 4075b960958d2d83.

| Month | Ordered h | Capacity h | Backlog h | Queue (months) | Jobs out unchecked |
|---|---|---|---|---|---|
| Jan 1852 | 160 | 80 | 0 | 0.00 | 0 |
| Apr 1852 | 160 | 80 | 240 | 3.00 | 0 |
| May 1852 | 160 | 80 | 240 | 3.00 | 2 |
| Jul 1852 | 160 | 80 | 240 | 3.00 | 6 |
| Aug 1852 | 160 | 80 | 240 | 3.00 | 8 |
| Sep 1852 | 160 | 160 | 220 | 1.38 | 9 |
| Jan 1853 | 160 | 160 | 220 | 1.38 | 9 |
| Jan 1854 | 160 | 160 | 220 | 1.38 | 9 |
| Jan 1855 | 160 | 160 | 220 | 1.38 | 9 |

First job delivered unchecked: month 3.25 (Apr 1852).

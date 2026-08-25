# Nothing but curl and a shell. The evaluator lives in the app; this only
# knocks on its door.
FROM alpine:3.20

RUN apk add --no-cache curl bc

COPY tick.sh /usr/local/bin/tick.sh
RUN chmod +x /usr/local/bin/tick.sh

# No shell interpolation, so a missing variable fails loudly in tick.sh
# rather than silently curling nothing.
ENTRYPOINT ["/usr/local/bin/tick.sh"]

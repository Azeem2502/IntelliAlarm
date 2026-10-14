import sys
from amqtt.scripts.broker_script import main

if __name__ == "__main__":
    sys.argv = ["amqtt", "-c", "amqtt.yaml"]
    main()

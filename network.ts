import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Subnet, SubnetType, NATOptions, NetworkConfig, Network, NATConfig } from "./types";

function validateNetworkConfig({ nat, subnets }: NetworkConfig) {
    switch (nat) {
        case undefined:
        case NATOptions.None:
            break;
        case NATOptions.InOneAZ:
        case NATOptions.OnePerAZ:
            if (!subnets.some(({ type }) => type === SubnetType.Public)) throw new Error("At least one public and private subnet are required for NAT Gateway usage");
            break;
        default:
            throw new Error(`NAT config ${nat} not supported`);
    }
}

export function createNetwork(config: NetworkConfig): Network {
    validateNetworkConfig(config);

    const vpc = new aws.ec2.Vpc("vpc", {
        cidrBlock: config.cidrBlock,
        tags: config.tags
    });

    const { nat, subnets: subnetsConfigs } = config;
    if (subnetsConfigs.length == 0) {
        throw new Error("No subnets configs provided")
    }

    let internetGateway: aws.ec2.InternetGateway | undefined = undefined;

    const subnets: Subnet[] = [];
    for (let index in subnetsConfigs) {
        const { az, cidrBlock, type } = subnetsConfigs[index];

        const subnet = new aws.ec2.Subnet(`${type}-subnet-${az}`, {
            vpcId: vpc.id,
            cidrBlock: cidrBlock,
            availabilityZone: az,
            mapPublicIpOnLaunch: (type === SubnetType.Public),
            tags: config.tags
        });

        switch (type) {
            case SubnetType.Public:
                if (!internetGateway) {
                    internetGateway = new aws.ec2.InternetGateway("internet-gateway", {
                        vpcId: vpc.id
                    });
                }

                const routeTable = vpc.id.apply((id) => aws.ec2.getRouteTable({
                    filters: [
                        {
                            name: "vpc-id",
                            values: [id],
                        },
                        {
                            name: "association.main",
                            values: ["true"],
                        }
                    ]
                }));

                new aws.ec2.Route(`${type}-route-${az}`, {
                    routeTableId: routeTable.id,
                    destinationCidrBlock: "0.0.0.0/0",
                    gatewayId: internetGateway.id
                });

                new aws.ec2.RouteTableAssociation(`${type}-route-table-association-${az}`, {
                    subnetId: subnet.id,
                    routeTableId: routeTable.id
                });
                break;
            case SubnetType.Private:
                break
            default:
                throw new Error(`Subnet type ${type} not supported`)
        }

        subnets.push({
            ...subnetsConfigs[index],
            resource: subnet
        });
    }

    switch (nat) {
        case undefined:
        case NATOptions.None:
            break;
        case NATOptions.OnePerAZ:
            const found = subnets.find(({ type }) => type === SubnetType.Public);
            if (!found) throw new Error("No public subnets found to support NAT Gateway configuration");

            const natGateways: aws.ec2.NatGateway[] = [];

            const publicSubnets = subnets.filter(({ type }) => type === SubnetType.Public)
            publicSubnets.forEach((current) => {
                natGateways.push(createNATGateway({
                    subnetId: current.resource.id,
                    az: current.az,
                    tags: config.tags
                }));
            });

            const privateSubnets = subnets.filter(({ type }) => type === SubnetType.Private)
            privateSubnets.forEach((current) => {
                natGateways.forEach((natGateway) => {
                    createNATRouteTable(vpc.id, current.resource.id, current.az, natGateway.id);
                })
            });
            break;
        case NATOptions.InOneAZ:
            const subnet = subnets.find(({ type }) => type === SubnetType.Public);
            if (!subnet) throw new Error("No public subnets found to support NAT Gateway configuration");

            const natGateway = createNATGateway({
                subnetId: subnet.resource.id,
                az: subnet.az,
                tags: config.tags
            });

            subnets.filter(({ type }) => type === SubnetType.Private).forEach((current) => {
                createNATRouteTable(vpc.id, current.resource.id, current.az, natGateway.id);
            });
            break;
        default:
            throw new Error(`NAT config ${nat} not supported`);
    }

    return {
        subnets,
        vpcId: vpc.id
    }
}

function createNATGateway({ subnetId, az, tags }: NATConfig): aws.ec2.NatGateway {
    const eip = new aws.ec2.Eip(`eip-${az}`, {});

    return new aws.ec2.NatGateway(`nat-gateway-${az}`, {
        allocationId: eip.id,
        subnetId,
        tags
    });
}

function createNATRouteTable(vpcId: pulumi.Output<string>, subnetId: pulumi.Output<string>, az: string, natGatewayId: pulumi.Output<string>) {
    const routeTable = new aws.ec2.RouteTable(`route-table-${az}`, {
        vpcId,
    });

    new aws.ec2.Route(`private-route-${az}`, {
        routeTableId: routeTable.id,
        destinationCidrBlock: "0.0.0.0/0",
        natGatewayId
    });

    new aws.ec2.RouteTableAssociation(`private-route-table-association-${az}`, {
        subnetId,
        routeTableId: routeTable.id,
    });
}